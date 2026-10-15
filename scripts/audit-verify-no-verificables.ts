// Verificacion de los ausentes que no se pueden verificar (2026-10-15):
// - A: CDO con el detalle en 200 y sin variantes vendibles confirma BAJA.
// - C: el no-verificado lleva su causa; el permanente pasa a "a revisar" en
//   la primera corrida y el transitorio a las 3 completas seguidas;
//   "Pausar sin confirmación del proveedor" separado de "Pausar estos N".
//
// Corre SOLO contra la base de prueba de la etapa C, con la API de CDO
// SIMULADA (el fetch a la URL de prueba no sale a la red):
//
//   DATABASE_URL=postgresql://…@localhost:5432/ganchito_estudio_c_test \
//     npx tsx scripts/audit-verify-no-verificables.ts
//
// Borra las corridas de la base de prueba y sus propios productos de CDO.
import "dotenv/config";
import fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Prisma, ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { MOTIVO_FUERA_DE_TOPE, textoNoVerificado, textoNoVerificados } from "../src/lib/sync/textos";
import {
  confirmarYPausar,
  estadoDelProveedor,
  pausarSinConfirmacion,
  type SyncRunSummary,
} from "../src/lib/sync-run";
import { armarAlerta } from "../src/lib/email";
import { SyncRunSummaryLine } from "../src/components/admin/sync-run-summary";

const db = new URL(process.env.DATABASE_URL ?? "postgres://x");
if (db.hostname !== "localhost" || !db.pathname.endsWith("_c_test")) {
  console.error(`ABORTADO: este script solo corre contra la base *_c_test en localhost (vino ${db.hostname}${db.pathname}).`);
  process.exit(1);
}
const CDO_FALSO = "https://cdo-falso.test/v2";
process.env.CDO_API_URL = CDO_FALSO;
process.env.CDO_API_TOKEN = "falso";
delete process.env.RESEND_API_KEY;
delete process.env.ALERT_EMAIL;

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

// --- Productos de prueba (cdoId de 9100001 en adelante) --------------------------
const P = {
  sinVariantes: "9100001", // code CON-SIN-VAR: 200 con variants []
  conVariantes: "9100002", // code CON-VAR: 200 con una variante vendible
  sinCode: "9100003", // sin code guardado: permanente
  caido: "9100004", // code CAIDO: 503 -> transitorio
  codeRaro: "9100005", // code con forma rara: permanente
  codeAjeno: "9100006", // code AJENO: el detalle es de otro producto
  viejo: "9100007", // para la corrida vieja sin detalle
};
const CODES: Record<string, string | null> = {
  [P.sinVariantes]: "CON-SIN-VAR",
  [P.conVariantes]: "CON-VAR",
  [P.sinCode]: null,
  [P.caido]: "CAIDO",
  [P.codeRaro]: "25% de descuento!!!!!",
  [P.codeAjeno]: "AJENO",
  [P.viejo]: "VIEJO",
};

// --- CDO simulado ----------------------------------------------------------------
const pedidos: string[] = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(CDO_FALSO)) return fetchReal(input, init);
  if ((init?.method ?? "GET") !== "GET") throw new Error(`metodo no permitido: ${init?.method}`);
  const code = decodeURIComponent(url.slice(`${CDO_FALSO}/products/`.length));
  pedidos.push(code);
  const variante = { id: 1, sku: "X-1", net_price: "10.5", stock_available: 5, stock_existent: 5 };
  const producto = (id: string, variants: unknown[]) => ({ id: Number(id), code, name: `Producto ${code}`, variants });
  switch (code) {
    case "CON-SIN-VAR":
      return Response.json(producto(P.sinVariantes, []));
    case "CON-VAR":
      return Response.json(producto(P.conVariantes, [variante]));
    case "CAIDO":
      return new Response("Service Unavailable", { status: 503 });
    case "AJENO":
      return Response.json(producto("4242", [variante]));
    default:
      return new Response("{}", { status: 404 });
  }
}) as typeof fetch;

async function crearProductos() {
  await prisma.product.deleteMany({ where: { origin: ProductOrigin.CDO, cdoId: { startsWith: "91000" } } });
  for (const [cdoId, code] of Object.entries(CODES)) {
    await prisma.product.create({
      data: {
        origin: ProductOrigin.CDO,
        cdoId,
        externalId: code,
        name: `Prueba ${cdoId}`,
        active: true,
        variants: {
          create: { sku: `cdo-${cdoId}-X`, costPrice: new Prisma.Decimal(10), stock: 7, reservedStock: 2, active: true },
        },
      },
    });
  }
}

const activo = async (cdoId: string) =>
  (await prisma.product.findUnique({ where: { cdoId }, select: { active: true } }))?.active;

/// Una corrida completa de CDO con el resumen dado (lo minimo que leen el
/// estado y la racha), terminada `minutos` despues de una base fija.
let reloj = Date.UTC(2030, 2, 1, 12, 0, 0);
/// Cuanto avanza el reloj entre corridas: 12 h (dos automaticas por dia),
/// salvo en la prueba de las corridas seguidas a mano.
let pasoMs = 12 * 3_600_000;
async function corridaCompleta(
  noVerificados: string[],
  detalle: SyncRunSummary["noVerificadosDetalle"],
  extra: Partial<SyncRunSummary> = {}
) {
  reloj += pasoMs;
  const summary: SyncRunSummary = {
    version: 1,
    creados: 0,
    actualizados: 0,
    fallidos: 0,
    pausadosSinPrecio: 0,
    monedaSospechosa: 0,
    totalRemoto: 0,
    vistos: 0,
    activos: 0,
    umbral: 5,
    ausentes: noVerificados,
    umbralFrenado: false,
    autoPausados: [],
    aRevisar: [],
    noVerificados,
    yaPausadosFueraDeApi: [],
    variantesDesactivadas: 0,
    productosSinVariantes: 0,
    nombres: {},
    ...(detalle ? { noVerificadosDetalle: detalle } : {}),
    ...extra,
  };
  return prisma.syncRun.create({
    data: {
      provider: ProductOrigin.CDO,
      status: SyncRunStatus.DONE,
      startedBy: "cron",
      startedAt: new Date(reloj - 60_000),
      finishedAt: new Date(reloj),
      heartbeatAt: new Date(reloj),
      summary: summary as unknown as Prisma.InputJsonValue,
    },
  });
}
async function corridaFallida() {
  reloj += pasoMs;
  await prisma.syncRun.create({
    data: {
      provider: ProductOrigin.CDO,
      status: SyncRunStatus.FAILED,
      startedBy: "cron",
      startedAt: new Date(reloj - 60_000),
      finishedAt: new Date(reloj),
      heartbeatAt: new Date(reloj),
      errors: [{ externalId: "-", message: "falla de prueba" }],
    },
  });
}
const escalados = async () =>
  (await estadoDelProveedor(ProductOrigin.CDO, new Date(reloj + 60_000))).sinVerificar.map((x) => x.externalId).sort();

async function main() {
  await prisma.syncRun.deleteMany({});
  await crearProductos();

  console.log("=========== A + CAUSAS: CONFIRMACION CONTRA CDO (SIMULADO) ===========");
  const runConfirmacion = await corridaCompleta([], {});
  const ids = Object.values(P).filter((id) => id !== P.viejo);
  const r = await confirmarYPausar(ProductOrigin.CDO, ids, runConfirmacion.id);
  check("200 sin variantes vendibles: BAJA", r.bajas.includes(P.sinVariantes), JSON.stringify(r.bajas));
  check("y queda pausado", (await activo(P.sinVariantes)) === false);
  const registrado = (await prisma.syncRun.findUniqueOrThrow({ where: { id: runConfirmacion.id } })).autoPausedExternalIds as string[];
  check("y registrado en la corrida como auto-pausado", registrado.includes(P.sinVariantes));
  check("200 con variantes: PRESENTE (a revisar), sigue activo", r.aRevisar.includes(P.conVariantes) && (await activo(P.conVariantes)) === true);
  const d = r.detalle;
  check("sin code: no verificado PERMANENTE", d[P.sinCode]?.permanente === true && d[P.sinCode].motivo === "falta el code de CDO", JSON.stringify(d[P.sinCode]));
  check("503: no verificado TRANSITORIO", d[P.caido]?.permanente === false, JSON.stringify(d[P.caido]));
  check("code con forma rara: PERMANENTE, y no se consulta", d[P.codeRaro]?.permanente === true && !pedidos.includes(CODES[P.codeRaro]!), JSON.stringify(d[P.codeRaro]));
  check("code de otro producto: PERMANENTE (no se toma por presente)", d[P.codeAjeno]?.permanente === true && !r.aRevisar.includes(P.codeAjeno), JSON.stringify(d[P.codeAjeno]));
  check("ningun no-verificado se pausa", [P.sinCode, P.caido, P.codeRaro, P.codeAjeno].every((id) => r.noVerificados.includes(id)) && (await activo(P.sinCode)) === true && (await activo(P.caido)) === true);
  check("solo GET a la API simulada", pedidos.length > 0);
  // Tope de confirmaciones: los que quedan afuera son transitorios.
  const conTope = await confirmarYPausar(ProductOrigin.CDO, [P.conVariantes, P.caido], runConfirmacion.id, 1);
  check("fuera del tope: TRANSITORIO", conTope.sinIntentar.includes(P.caido) && conTope.detalle[P.caido]?.permanente === false, JSON.stringify(conTope.detalle[P.caido]));

  console.log("\n=========== C: CUANDO PASA A 'A REVISAR' ===========");
  await prisma.syncRun.deleteMany({});
  const nv = [P.sinCode, P.caido];
  const det = { [P.sinCode]: d[P.sinCode], [P.caido]: d[P.caido] };
  await corridaCompleta(nv, det);
  let e = await escalados();
  check("1a corrida: el permanente ya esta a revisar, el transitorio no", JSON.stringify(e) === JSON.stringify([P.sinCode]), e.join(","));
  check("y el estado es A_REVISAR (no verde)", (await estadoDelProveedor(ProductOrigin.CDO, new Date(reloj + 60_000))).estado === "A_REVISAR");
  await corridaFallida(); // no dice nada del producto: no corta la racha
  await corridaCompleta(nv, det);
  e = await escalados();
  check("2a corrida (con una FAILED en el medio): el transitorio todavia no", !e.includes(P.caido), e.join(","));
  await corridaCompleta([], {}, { umbralFrenado: true, ausentes: nv }); // frenada: no confirmo nada, se saltea
  await corridaCompleta(nv, det);
  e = await escalados();
  check("3a corrida seguida (salteando FAILED y frenada): el transitorio pasa", e.includes(P.caido) && e.includes(P.sinCode), e.join(","));
  const est = await estadoDelProveedor(ProductOrigin.CDO, new Date(reloj + 60_000));
  const delCaido = est.sinVerificar.find((x) => x.externalId === P.caido);
  check("con su motivo transitorio", delCaido?.permanente === false && !!delCaido.motivo);

  await corridaCompleta([P.sinCode], { [P.sinCode]: d[P.sinCode] }); // el transitorio se verifico
  e = await escalados();
  check("una corrida que lo verifica corta la racha", !e.includes(P.caido), e.join(","));
  await corridaCompleta(nv, det);
  await corridaCompleta(nv, det);
  e = await escalados();
  check("despues del corte, 2 seguidas no alcanzan", !e.includes(P.caido), e.join(","));
  await corridaCompleta(nv, det);
  check("a la 3a vuelve a pasar", (await escalados()).includes(P.caido));

  // Corridas anteriores al detalle: sus no verificados cuentan como transitorios.
  await prisma.syncRun.deleteMany({});
  await corridaCompleta([P.viejo], undefined);
  await corridaCompleta([P.viejo], undefined);
  check("viejas sin detalle: 2 no alcanzan", !(await escalados()).includes(P.viejo));
  await corridaCompleta([P.viejo], undefined);
  check("viejas sin detalle: a la 3a pasa (como transitorio)", (await escalados()).includes(P.viejo));

  // Tres corridas a mano en 20 minutos (clicks al boton durante una caida):
  // no alcanzan, la racha tiene que abarcar RACHA_MINIMA_MS.
  await prisma.syncRun.deleteMany({});
  pasoMs = 10 * 60_000;
  await corridaCompleta(nv, det);
  await corridaCompleta(nv, det);
  await corridaCompleta(nv, det);
  pasoMs = 12 * 3_600_000;
  e = await escalados();
  check("3 seguidas en 20 minutos: el transitorio NO pasa (el permanente si)", !e.includes(P.caido) && e.includes(P.sinCode), e.join(","));

  console.log("\n=========== PAUSAR SIN CONFIRMACION DEL PROVEEDOR ===========");
  await prisma.syncRun.deleteMany({});
  const ultima = await corridaCompleta(nv, det);
  const autoAntes = JSON.stringify(ultima.autoPausedExternalIds);
  let rechazo = "";
  try {
    await pausarSinConfirmacion(ProductOrigin.CDO, [P.sinCode, P.conVariantes], "admin@ejemplo.test");
  } catch (err) {
    rechazo = err instanceof Error ? err.message : String(err);
  }
  check("un id fuera de la lista se rechaza (y no se pausa NINGUNO)", rechazo.includes(P.conVariantes) && (await activo(P.sinCode)) === true, rechazo.slice(0, 80));
  let rechazoTransitorio = "";
  try {
    await pausarSinConfirmacion(ProductOrigin.CDO, [P.caido], "admin@ejemplo.test");
  } catch (err) {
    rechazoTransitorio = err instanceof Error ? err.message : String(err);
  }
  check("un transitorio que todavia no escalo se rechaza", rechazoTransitorio.length > 0 && (await activo(P.caido)) === true);
  const ok = await pausarSinConfirmacion(ProductOrigin.CDO, [P.sinCode], "admin@ejemplo.test");
  check("el valido se pausa", ok.pausados.length === 1 && (await activo(P.sinCode)) === false);
  const tras = await prisma.syncRun.findUniqueOrThrow({ where: { id: ultima.id } });
  const nota = (tras.errors as Array<{ externalId: string; message: string }>).at(-1)?.message ?? "";
  check("nota en la corrida con quien lo hizo", nota.startsWith("Pausar sin confirmación del proveedor: admin@ejemplo.test") && nota.includes(P.sinCode), nota.slice(0, 90));
  check("autoPausedExternalIds NO cambia", JSON.stringify(tras.autoPausedExternalIds) === autoAntes);
  check("pausado, ya no esta a revisar", !(await escalados()).includes(P.sinCode));

  // Termina una corrida nueva entre el calculo de la lista y la pausa: se
  // aborta sin pausar nada (el producto pudo volver al listado).
  await prisma.product.update({ where: { cdoId: P.sinCode }, data: { active: true } });
  const txOriginal = prisma.$transaction.bind(prisma);
  let intercalada = false;
  (prisma as unknown as { $transaction: unknown }).$transaction = async (...args: unknown[]) => {
    if (!intercalada) {
      intercalada = true;
      await corridaCompleta(nv, det);
    }
    return (txOriginal as (...a: unknown[]) => unknown)(...args);
  };
  let abortada = "";
  try {
    await pausarSinConfirmacion(ProductOrigin.CDO, [P.sinCode], "admin@ejemplo.test");
  } catch (err) {
    abortada = err instanceof Error ? err.message : String(err);
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = txOriginal;
  }
  check("si termina otra corrida en el medio, aborta y no pausa", abortada.startsWith("Terminó una corrida nueva") && (await activo(P.sinCode)) === true, abortada.slice(0, 60));

  // El permiso: la Server Action pasa por requireAdmin ANTES de todo, igual
  // que "Pausar estos N". No se puede ejecutar fuera de Next (sin sesion),
  // asi que se verifica en el codigo.
  const acciones = fs.readFileSync("src/app/admin/(panel)/proveedores/actions.ts", "utf8");
  const cuerpo = (nombre: string) => {
    const i = acciones.indexOf(`export async function ${nombre}(`);
    return acciones.slice(i, acciones.indexOf("\n}\n", i));
  };
  const nueva = cuerpo("pausarSinConfirmacion");
  const vieja = cuerpo("pausarAusentes");
  check("la accion nueva arranca con requireAdmin (mismo permiso que 'Pausar estos N')", /\)[^{]*\{[\s\S]*?const admin = await requireAdmin\(\);/.test(nueva) && vieja.includes("await requireAdmin()"));
  check("y no pasa por el camino de 'Pausar estos N'", !nueva.includes("pausarAusentesDeCorrida") && !vieja.includes("pausarSinConfirmacion"));

  console.log("\n=========== TEXTOS ===========");
  const tope1 = textoNoVerificados(1, false, MOTIVO_FUERA_DE_TOPE, "CDO Promocionales");
  const tope2 = textoNoVerificado(false, MOTIVO_FUERA_DE_TOPE, "CDO Promocionales");
  check("fuera del tope: no dice que el proveedor no respondio", !/no respondió/.test(tope1 + tope2) && /fuera del tope/.test(tope1) && /fuera del tope/.test(tope2), tope1);
  const resumen = (ultima.summary ?? {}) as unknown as SyncRunSummary;
  const linea = renderToStaticMarkup(createElement(SyncRunSummaryLine, { summary: resumen, proveedor: "CDO Promocionales" }))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ");
  check(
    "linea: permanente sin promesa de reintento",
    linea.includes("1 no se puede verificar: falta el code de CDO. Revisalo y pausalo a mano si corresponde"),
    linea.slice(-160)
  );
  check(
    "linea: transitorio con el proveedor y el reintento",
    linea.includes("1 no se pudo verificar: CDO Promocionales no respondió (se reintenta en la próxima corrida)")
  );
  check("linea: no termina en un separador suelto", !/·\s*$/.test(linea));
  const mail = armarAlerta({
    motivo: "a-revisar",
    provider: "CDO",
    runId: "x",
    productos: [],
    sinVerificar: [
      { externalId: P.sinCode, nombre: "Uno", stockDisponible: 0, permanente: true, motivoVerificacion: "falta el code de CDO" },
      { externalId: P.caido, nombre: "Dos", stockDisponible: 3, permanente: false, motivoVerificacion: "status 503" },
    ],
  });
  check("mail: titulo cuenta los no verificables", mail.titulo.includes("2 productos a revisar"), mail.titulo);
  check("mail: permanente sin reintento", mail.cuerpo.includes("no se puede verificar: falta el code de CDO. Revisalo y pausalo a mano si corresponde"));
  check("mail: transitorio con reintento", mail.cuerpo.includes("no se pudo verificar: CDO Promocionales no respondió (se reintenta en la próxima corrida)"));
  check("mail: menciona el boton nuevo", mail.cuerpo.includes("Pausar sin confirmación del proveedor"));
  check("mail: sin la seccion de 'publicados' cuando no hay", !mail.cuerpo.includes("su ficha sigue publicada"));
}

main()
  .catch((e) => {
    fallos++;
    console.error("TIRO:", e);
  })
  .finally(async () => {
    await prisma.syncRun.deleteMany({}).catch(() => {});
    await prisma.product.deleteMany({ where: { origin: ProductOrigin.CDO, cdoId: { startsWith: "91000" } } }).catch(() => {});
    console.log(fallos ? `\n${fallos} chequeo(s) fallaron.` : "\nTodos los chequeos pasan.");
    process.exitCode = fallos ? 1 : 0;
    await prisma.$disconnect();
  });

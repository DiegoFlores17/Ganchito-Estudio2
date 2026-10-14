// Verificacion de la etapa B contra la base LOCAL: resumen fijo por
// corrida, confirmacion de ausentes, "Pausar estos N", estados del
// proveedor y startedBy al retomar.
//
//   npx tsx scripts/audit-verify-syncrun-b.ts
//
// Escribe productos de prueba (zecatId "btest-*") y corridas de prueba, y
// borra todo al final. La API de Zecat esta interceptada (fetch): no sale
// ningun request a la red.
import "dotenv/config";
import { ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { confirmarAusencia } from "../src/lib/zecat/client";
import {
  confirmarYPausar,
  estadoDelProveedor,
  finishSyncRun,
  leerSummary,
  pausarAusentesDeCorrida,
  umbralDeSeguridad,
  DESACTUALIZADO_MS,
} from "../src/lib/sync-run";
import { tomarLease } from "../src/lib/sync/motor";
import { crearCorrida, registrarAvance } from "./_pruebas-sync";

// Guarda de entorno: este script ESCRIBE. Solo contra localhost.
const destino = new URL(process.env.DATABASE_URL ?? "postgres://x").hostname;
if (destino !== "localhost" && destino !== "127.0.0.1") {
  console.error(`ABORTADO: DATABASE_URL apunta a ${destino}, no a localhost.`);
  process.exit(1);
}
delete process.env.RESEND_API_KEY;
process.env.ALERT_EMAIL = "alertas@ejemplo.test";
process.env.ZECAT_API_URL = "https://api-falsa.ejemplo.test/v1";
process.env.ZECAT_API_TOKEN = "falso";

const PREFIJO = "btest-";
const AUTOR = "audit-verify-syncrun-b";
const AUTORES_DE_PRUEBA = [AUTOR, "quien-la-empezo@ejemplo.test"];
const corridasDePrueba: string[] = [];
let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

// --- API de Zecat simulada -------------------------------------------------
type Respuesta = "404" | "despublicado" | "sin-variantes" | "sano" | "500" | "timeout" | "red" | "colgado";
const respuestas = new Map<string, Respuesta>();
const detalle = (id: string, extra: Record<string, unknown>) => ({
  generic_product: {
    id,
    name: `Producto ${id}`,
    published: true,
    variants: { colors: { "0": [{ sku: `${id}-v`, active: true }] }, sizes: {} },
    ...extra,
  },
});
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://api-falsa.ejemplo.test/")) throw new Error(`Request inesperado: ${url}`);
  const id = decodeURIComponent(url.split("/generic_product/")[1] ?? "");
  switch (respuestas.get(id)) {
    case "404": return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    case "despublicado": return Response.json(detalle(id, { published: false }));
    case "sin-variantes": return Response.json(detalle(id, { variants: { colors: {}, sizes: {} } }));
    case "sano": return Response.json(detalle(id, {}));
    case "500": return new Response("error", { status: 500, statusText: "Internal Server Error" });
    case "timeout": throw new DOMException("The operation timed out.", "TimeoutError");
    case "red": throw new TypeError("fetch failed");
    case "colgado":
      // No responde nunca: solo el AbortSignal del cliente lo puede cortar.
      return new Promise<Response>((_, reject) => {
        if (!init?.signal) return; // sin signal colgaria para siempre: el test lo detecta por tiempo
        init.signal.addEventListener("abort", () => reject(init.signal!.reason));
      });
    default: throw new Error(`Sin respuesta configurada para ${id}`);
  }
}) as typeof fetch;

// --- Helpers ---------------------------------------------------------------
async function crearProductos(ids: string[]) {
  for (const id of ids) {
    await prisma.product.create({
      data: {
        origin: ProductOrigin.ZECAT,
        zecatId: id,
        name: `Producto de prueba ${id}`,
        active: true,
        variants: { create: [{ sku: `${id}-v`, costPrice: 100, stock: 10 }] },
      },
    });
  }
}

/// Una corrida completa donde el proveedor NO devolvio `ausentes`. Vistos =
/// todos los zecat locales menos esos, para no tocar los reales.
async function correrConAusentes(ausentes: string[], startedBy = AUTOR) {
  const run = await crearCorrida(ProductOrigin.ZECAT, startedBy);
  corridasDePrueba.push(run.id);
  const todos = await prisma.product.findMany({
    where: { origin: ProductOrigin.ZECAT, zecatId: { not: null } },
    select: { zecatId: true },
  });
  await registrarAvance(run.id, {
    cursor: 1,
    counters: { created: 1, updated: 2, paused: 0, failed: 0, usdWarnings: 0 },
    seenExternalIds: todos.map((t) => t.zecatId!).filter((id) => !ausentes.includes(id)),
    errors: [],
  });
  return { runId: run.id, fin: await finishSyncRun(run.id) };
}

async function activo(zecatId: string) {
  return (await prisma.product.findUniqueOrThrow({ where: { zecatId } })).active;
}

async function limpiar() {
  // Por id (las de esta corrida) y por autor (las que haya dejado un crash
  // anterior). Nunca un deleteMany sin filtro: la base local tiene corridas
  // reales.
  await prisma.syncRun.deleteMany({
    where: { OR: [{ id: { in: corridasDePrueba } }, { startedBy: { in: AUTORES_DE_PRUEBA } }] },
  });
  await prisma.product.deleteMany({ where: { zecatId: { startsWith: PREFIJO } } });
}

async function main() {
  await limpiar();
  const corriendo = await prisma.syncRun.findFirst({
    where: { provider: ProductOrigin.ZECAT, status: SyncRunStatus.RUNNING },
  });
  if (corriendo) throw new Error("Hay una corrida RUNNING en local: este script necesita el lock libre.");

  console.log("=========== CONFIRMACION: cada tipo de respuesta ===========");
  const casos: Array<[Respuesta, string]> = [
    ["404", "baja"], ["despublicado", "baja"], ["sin-variantes", "baja"],
    ["sano", "presente"], ["500", "no-verificado"], ["timeout", "no-verificado"], ["red", "no-verificado"],
  ];
  for (const [resp, esperado] of casos) {
    respuestas.set(`${PREFIJO}c-${resp}`, resp);
    const r = await confirmarAusencia(`${PREFIJO}c-${resp}`);
    check(`${resp} -> ${esperado}`, r.resultado === esperado, `${r.resultado}: ${r.motivo}`);
  }

  respuestas.set(`${PREFIJO}c-colgado`, "colgado");
  // AbortSignal.timeout usa un timer que NO mantiene vivo a Node: con el
  // fetch simulado colgado no queda nada pendiente y el proceso saldria en
  // silencio a mitad del await. Un servidor real siempre tiene handles
  // abiertos; en el script hay que sostenerlo a mano.
  const sostener = setTimeout(() => {}, 30_000);
  const t0 = Date.now();
  const colgado = await confirmarAusencia(`${PREFIJO}c-colgado`);
  clearTimeout(sostener);
  const segundos = (Date.now() - t0) / 1000;
  check("colgado: el AbortSignal real corta a los ~15 s -> no-verificado", colgado.resultado === "no-verificado" && segundos >= 14 && segundos < 20, `${segundos.toFixed(1)} s: ${colgado.motivo}`);

  const sinConfirmador = await confirmarYPausar(ProductOrigin.CDO, ["x1", "x2"], "sin-corrida");
  check("proveedor sin confirmador: nada se confirma ni se pausa", sinConfirmador.bajas.length === 0 && sinConfirmador.noVerificados.length === 2);

  console.log("\n=========== LEASE E INDICE PARCIAL ===========");
  const lockRun = await crearCorrida(ProductOrigin.ZECAT, AUTOR);
  corridasDePrueba.push(lockRun.id);
  const primero = await tomarLease(lockRun.id);
  const segundo = await tomarLease(lockRun.id);
  check("el lease deja entrar a una sola invocacion", primero.ok && !segundo.ok);
  await prisma.syncRun.update({ where: { id: lockRun.id }, data: { leaseUntil: null } });
  let indiceCorta = false;
  try {
    await prisma.syncRun.create({ data: { provider: ProductOrigin.ZECAT, startedBy: AUTOR } });
  } catch {
    indiceCorta = true;
  }
  check("el indice parcial corta un segundo RUNNING insertado directo", indiceCorta);
  await registrarAvance(lockRun.id, { cursor: 3, counters: { created: 1, updated: 2, paused: 0, failed: 0, usdWarnings: 0 }, seenExternalIds: ["a", "b", "c"], errors: [] });

  console.log("\n=========== CORDURA: respuesta anomala aborta sin calcular ausencia ===========");
  const finCordura = await finishSyncRun(lockRun.id); // 3 vistos contra cientos de activos
  check("aborta FAILED, sin resumen y sin pausar nada", finCordura.aborted && finCordura.run.status === SyncRunStatus.FAILED && finCordura.summary === null);

  console.log("\n=========== CIERRE BAJO EL UMBRAL: solo se pausa lo confirmado ===========");
  const [baja, despub, sano, error500, timeout] = ["baja", "despub", "sano", "e500", "timeout"].map((x) => `${PREFIJO}${x}`);
  await crearProductos([baja, despub, sano, error500, timeout]);
  respuestas.set(baja, "404");
  respuestas.set(despub, "despublicado");
  respuestas.set(sano, "sano");
  respuestas.set(error500, "500");
  respuestas.set(timeout, "timeout");
  const { runId: run1, fin: fin1 } = await correrConAusentes([baja, despub, sano, error500, timeout]);
  check("corrida DONE con resumen", !fin1.aborted && fin1.summary !== null);
  const s1 = fin1.summary!;
  check("resumen: 5 ausentes, umbral no frenado", s1.ausentes.length === 5 && !s1.umbralFrenado);
  check("resumen: pausados = los dos confirmados", [...s1.autoPausados].sort().join() === [baja, despub].sort().join(), s1.autoPausados.join());
  check("resumen: el sano queda 'a revisar'", s1.aRevisar.join() === sano);
  check("resumen: 500 y timeout quedan 'no verificados'", [...s1.noVerificados].sort().join() === [error500, timeout].sort().join());
  check("base: confirmados pausados, el resto sigue activo",
    !(await activo(baja)) && !(await activo(despub)) && (await activo(sano)) && (await activo(error500)) && (await activo(timeout)));
  check("resumen: nombres guardados", s1.nombres[baja] === `Producto de prueba ${baja}`);
  check("corrida: autoPausedExternalIds = confirmados", [...((await prisma.syncRun.findUniqueOrThrow({ where: { id: run1 } })).autoPausedExternalIds as string[])].sort().join() === [baja, despub].sort().join());

  console.log("\n=========== 'A REVISAR' NO DEJA EL ESTADO EN VERDE ===========");
  let est = await estadoDelProveedor(ProductOrigin.ZECAT);
  check("con un 'a revisar' activo: A_REVISAR (ambar), no OK", est.estado === "A_REVISAR" && est.aRevisar.join() === sano, `${est.estado} / ${est.aRevisar.join()}`);

  console.log("\n=========== EL RESUMEN QUEDA FIJO ===========");
  const antes = JSON.stringify((await prisma.syncRun.findUniqueOrThrow({ where: { id: run1 } })).summary);
  // Cambiar el estado del catalogo despues del cierre.
  await prisma.product.update({ where: { zecatId: baja }, data: { active: true } });
  await prisma.product.update({ where: { zecatId: sano }, data: { active: false } });
  await prisma.product.update({ where: { zecatId: baja }, data: { name: "Nombre cambiado despues" } });
  const despues = JSON.stringify((await prisma.syncRun.findUniqueOrThrow({ where: { id: run1 } })).summary);
  check("el resumen guardado no cambia al cambiar el catalogo", antes === despues);
  const leido = leerSummary(await prisma.syncRun.findUniqueOrThrow({ where: { id: run1 } }));
  check("leerSummary devuelve los nombres DEL CIERRE", leido?.nombres[baja] === `Producto de prueba ${baja}`);
  check("corrida vieja sin resumen: leerSummary = null (no se recalcula)", leerSummary({ summary: null }) === null);
  // El 'a revisar' se pauso (arriba): deja de contar.
  est = await estadoDelProveedor(ProductOrigin.ZECAT);
  check("'a revisar' pausado: ya no cuenta, estado OK", est.estado === "OK" && est.aRevisar.length === 0, est.estado);
  await prisma.product.updateMany({ where: { zecatId: { startsWith: PREFIJO } }, data: { active: false } });

  // Un 'a revisar' que VUELVE al listado: la corrida siguiente ya no lo tiene.
  const rev2 = `${PREFIJO}rev2`;
  await crearProductos([rev2]);
  respuestas.set(rev2, "sano");
  await correrConAusentes([rev2]);
  est = await estadoDelProveedor(ProductOrigin.ZECAT);
  check("nuevo 'a revisar': A_REVISAR", est.estado === "A_REVISAR" && est.aRevisar.join() === rev2, est.estado);
  await correrConAusentes([]); // ahora rev2 vino en el listado
  est = await estadoDelProveedor(ProductOrigin.ZECAT);
  check("vuelve al listado: estado OK, y el producto sigue activo", est.estado === "OK" && (await activo(rev2)), est.estado);
  await prisma.product.update({ where: { zecatId: rev2 }, data: { active: false } });

  console.log("\n=========== UMBRAL FRENADO + 'PAUSAR ESTOS N' ===========");
  const { umbral } = await umbralDeSeguridad(ProductOrigin.ZECAT);
  const n = umbral + 3;
  const masivos = Array.from({ length: n }, (_, i) => `${PREFIJO}m-${i}`);
  await crearProductos(masivos);
  // Respuestas al momento de apretar el boton: la mayoria baja, algunos no.
  masivos.forEach((id, i) => respuestas.set(id, i === 0 ? "sano" : i === 1 ? "500" : i === 2 ? "despublicado" : "404"));
  const { runId: runFrenada, fin: finFrenada } = await correrConAusentes(masivos);
  const sf = finFrenada.summary!;
  check(`frenado: ${n} ausentes > umbral ${umbral}, no se pausa ninguno`, sf.umbralFrenado && sf.autoPausados.length === 0 && (await activo(masivos[5])));
  let estado = await estadoDelProveedor(ProductOrigin.ZECAT);
  check("estado: BLOQUEADO con los pendientes", estado.estado === "BLOQUEADO" && estado.pendientes.length === n, `${estado.estado} / ${estado.pendientes.length}`);

  // Lo guardado en la base ANTES del boton (JSONB reordena las claves: se
  // compara base contra base, no contra el objeto en memoria).
  const summaryGuardado = JSON.stringify((await prisma.syncRun.findUniqueOrThrow({ where: { id: runFrenada } })).summary);
  const r = await pausarAusentesDeCorrida(runFrenada, "admin@ejemplo.test");
  check("pausa solo los confirmados (404 y despublicado)", r.pausados.length === n - 2 && r.aRevisar.length === 1 && r.noVerificados.length === 1, `${r.pausados.length}/${r.aRevisar.length}/${r.noVerificados.length}`);
  check("base: el sano y el 500 siguen activos, el resto pausado",
    (await activo(masivos[0])) && (await activo(masivos[1])) && !(await activo(masivos[2])) && !(await activo(masivos[5])));
  const tras = await prisma.syncRun.findUniqueOrThrow({ where: { id: runFrenada } });
  check("registrado en autoPausedExternalIds de ESA corrida", (tras.autoPausedExternalIds as string[]).length === n - 2);
  check("nota en errors con quien y cuantos", (tras.errors as Array<{ message: string }>).some((e) => e.message.includes("admin@ejemplo.test") && e.message.includes(`${n - 2} pausados`)));
  check("el resumen de esa corrida NO cambio", JSON.stringify(tras.summary) === summaryGuardado);
  estado = await estadoDelProveedor(ProductOrigin.ZECAT);
  check("estado: sigue BLOQUEADO por los 2 sin resolver", estado.estado === "BLOQUEADO" && estado.pendientes.length === 2, `${estado.estado} / ${estado.pendientes.length}`);

  // Segundo click: solo quedan los 2; ahora el 500 responde 404.
  respuestas.set(masivos[1], "404");
  const r2 = await pausarAusentesDeCorrida(runFrenada, "admin@ejemplo.test");
  check("segundo click: pausa el que ahora confirma, deja el sano", r2.pausados.join() === masivos[1] && r2.aRevisar.join() === masivos[0]);

  // Tope por llamada: con max=1, uno solo se intenta y el resto queda.
  const tope = await confirmarYPausar(ProductOrigin.ZECAT, [masivos[0], masivos[1]], runFrenada, 1);
  check("tope por llamada: el excedente queda sin intentar", tope.sinIntentar.length === 1 && tope.aRevisar.length + tope.bajas.length + tope.noVerificados.length === 1);

  // Resolver el ultimo por otro camino: deja de contar como pendiente.
  await prisma.product.update({ where: { zecatId: masivos[0] }, data: { active: false } });
  estado = await estadoDelProveedor(ProductOrigin.ZECAT);
  check("estado: OK cuando no quedan pendientes", estado.estado === "OK", estado.estado);

  console.log("\n=========== SOLO SOBRE LA ULTIMA CORRIDA COMPLETA ===========");
  await correrConAusentes([]);
  let error = "";
  try {
    await pausarAusentesDeCorrida(runFrenada, "admin@ejemplo.test");
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  check("una corrida que ya no es la ultima: rechaza", error.includes("última corrida completa"), error);

  console.log("\n=========== ESTADOS: DESACTUALIZADO y FALLANDO ===========");
  estado = await estadoDelProveedor(ProductOrigin.ZECAT);
  check("recien completada: OK", estado.estado === "OK", estado.estado);
  const futuro = new Date(estado.ultimaCompleta!.finishedAt.getTime() + DESACTUALIZADO_MS + 60_000);
  check("mas de 26 h sin completa: DESACTUALIZADO", (await estadoDelProveedor(ProductOrigin.ZECAT, futuro)).estado === "DESACTUALIZADO");
  const fallida = await prisma.syncRun.create({
    data: {
      provider: ProductOrigin.ZECAT,
      startedBy: AUTOR,
      status: SyncRunStatus.FAILED,
      finishedAt: new Date(),
      errors: [{ externalId: "-", message: "fallo de prueba" }],
    },
  });
  corridasDePrueba.push(fallida.id);
  estado = await estadoDelProveedor(ProductOrigin.ZECAT);
  check("ultima corrida fallida despues de la completa: FALLANDO", estado.estado === "FALLANDO" && estado.ultimaFallida?.id === fallida.id, estado.estado);
  // Una completa despues de la fallida vuelve a OK.
  await correrConAusentes([]);
  check("completa despues de la fallida: OK", (await estadoDelProveedor(ProductOrigin.ZECAT)).estado === "OK");

  console.log("\n=========== RETOME: startedBy se conserva ===========");
  // Corrida cuya invocacion murio: lease vencido y sin liberar.
  const muerta = await prisma.syncRun.create({
    data: {
      provider: ProductOrigin.ZECAT,
      startedBy: "quien-la-empezo@ejemplo.test",
      heartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
      leaseUntil: new Date(Date.now() - 60 * 1000),
    },
  });
  corridasDePrueba.push(muerta.id);
  const toma = await tomarLease(muerta.id);
  const retomada = await prisma.syncRun.findUniqueOrThrow({ where: { id: muerta.id } });
  check("retoma la misma fila y detecta la muerte", toma.ok && toma.murioAnterior);
  check("startedBy NO se pisa", retomada.startedBy === "quien-la-empezo@ejemplo.test", retomada.startedBy);
  check("la muerte queda anotada en errors", (retomada.errors as Array<{ message: string }>).some((e) => e.message.startsWith("Invocación cortada")));
  await prisma.syncRun.update({ where: { id: muerta.id }, data: { status: SyncRunStatus.FAILED, finishedAt: new Date() } });
}

main()
  .catch((e) => {
    fallos++;
    console.error("TIRO:", e);
  })
  .finally(async () => {
    await limpiar();
    const quedanP = await prisma.product.count({ where: { zecatId: { startsWith: PREFIJO } } });
    const quedanR = await prisma.syncRun.count({
      where: { OR: [{ id: { in: corridasDePrueba } }, { startedBy: { in: AUTORES_DE_PRUEBA } }] },
    });
    console.log(`\nLimpieza: ${quedanP} productos y ${quedanR} corridas de prueba quedan (esperado 0 y 0).`);
    console.log(fallos ? `\n${fallos} chequeo(s) fallaron.` : "\nTodos los chequeos pasan.");
    if (fallos || quedanP || quedanR) process.exitCode = 1;
    await prisma.$disconnect();
  });

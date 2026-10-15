// Verificacion de la etapa C (motor del cron) contra una base de PRUEBA
// aparte (ganchito_estudio_c_test, en el Postgres local), vacia y migrada:
// la corrida necesita un catalogo propio, y la base local real tiene ~600
// productos que el cierre trataria como ausentes.
//
//   DATABASE_URL=postgresql://…@localhost:5432/ganchito_estudio_c_test \
//     npx tsx scripts/audit-verify-motor-c.ts
//
// La base de prueba se crea una vez (en el Postgres local de docker) y se
// migra con la guarda de destino en el mismo comando:
//   CREATE DATABASE ganchito_estudio_c_test;   (desde la base local)
//   DATABASE_URL=…/ganchito_estudio_c_test npx prisma migrate deploy
// y se borra con DROP DATABASE ganchito_estudio_c_test cuando no hace falta.
//
// Zecat esta simulado (scripts/_zecat-falso.ts, un servidor HTTP local) y
// Resend interceptado: ningun request sale de la maquina. BORRA todo lo de
// la base de prueba al arrancar.
import "dotenv/config";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { avanzarCorrida, inicioDeVentana, LEASE_MS, VENTANAS_UTC } from "../src/lib/sync/motor";
import { revisarAlertas, vigilarFrescura } from "../src/lib/sync/alertas";
import { leerSummary } from "../src/lib/sync-run";
import { GET } from "../src/app/api/cron/sync/[provider]/route";
import { levantarZecatFalso, type EstadoFalso } from "./_zecat-falso";

// --- Guarda: SOLO la base de prueba de la etapa C --------------------------
const db = new URL(process.env.DATABASE_URL ?? "postgres://x");
if (db.hostname !== "localhost" || !db.pathname.endsWith("_c_test")) {
  console.error(`ABORTADO: este script solo corre contra la base *_c_test en localhost (vino ${db.hostname}${db.pathname}).`);
  process.exit(1);
}
const SECRET = "secreto-de-prueba";
process.env.CRON_SECRET = SECRET;
process.env.RESEND_API_KEY = "re_FALSA_solo_para_este_script";
process.env.ALERT_EMAIL = "alertas@ejemplo.test";
process.env.ZECAT_API_TOKEN = "falso";

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

// --- Resend interceptado -----------------------------------------------------
const mails: Array<{ asunto: string; html: string }> = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.resend.com")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    mails.push({ asunto: body.subject, html: body.html });
    return Response.json({ id: `mail-${mails.length}` });
  }
  if (!url.startsWith("http://127.0.0.1")) throw new Error(`Request inesperado a ${url}`);
  return fetchOriginal(input, init);
}) as typeof fetch;
const mailsCon = (texto: string) => mails.filter((m) => m.asunto.includes(texto) || m.html.includes(texto)).length;

// --- Zecat simulado ----------------------------------------------------------
const N = 100;
const ids = Array.from({ length: N }, (_, i) => `c-${String(i).padStart(3, "0")}`);
const estado: EstadoFalso = {
  listado: [...ids],
  detalle: new Map(),
  demoraDetalleMs: 0,
  listadoCaido: false,
  pedidosDetalle: new Map(),
};

// --- Helpers -----------------------------------------------------------------
const tickCron = (provider = "zecat", auth = `Bearer ${SECRET}`) =>
  GET(new Request(`http://x/api/cron/sync/${provider}`, { headers: { authorization: auth } }), {
    params: Promise.resolve({ provider }),
  });

async function correrHastaTerminar(startedBy: string) {
  let ticks = 0;
  for (;;) {
    ticks++;
    const r = await avanzarCorrida(ProductOrigin.ZECAT, startedBy, { esCron: false });
    if (r.estado === "completa" || r.estado === "fallo") return { r, ticks };
    if (ticks > 200) throw new Error("demasiados ticks");
  }
}

const runs = () => prisma.syncRun.findMany({ where: { provider: ProductOrigin.ZECAT }, orderBy: { startedAt: "asc" } });
async function envejecerCompletas(ms: number) {
  const done = await prisma.syncRun.findMany({ where: { status: SyncRunStatus.DONE } });
  for (const r of done) {
    await prisma.syncRun.update({
      where: { id: r.id },
      data: { finishedAt: new Date(r.finishedAt!.getTime() - ms), startedAt: new Date(r.startedAt.getTime() - ms) },
    });
  }
}
async function envejecerTodas(ms: number) {
  for (const r of await prisma.syncRun.findMany({ where: { status: { not: SyncRunStatus.RUNNING } } })) {
    await prisma.syncRun.update({
      where: { id: r.id },
      data: {
        startedAt: new Date(r.startedAt.getTime() - ms),
        finishedAt: r.finishedAt ? new Date(r.finishedAt.getTime() - ms) : null,
      },
    });
  }
}
function sinRepetidos(lista: string[]) {
  return new Set(lista).size === lista.length;
}

/// Lanza un tick en un PROCESO HIJO y lo mata con SIGKILL cuando el cursor
/// de la corrida abierta pasa `matarEn`.
async function tickHijoQueMuere(urlZecat: string, matarEn: number) {
  const hijo = spawn("npx", ["tsx", "scripts/_tick-hijo.ts"], {
    env: { ...process.env, ZECAT_API_URL: urlZecat, SYNC_TICK_BUDGET_MS: "120000" },
    detached: true,
    stdio: "ignore",
  });
  const t0 = Date.now();
  for (;;) {
    const abierta = await prisma.syncRun.findFirst({ where: { status: SyncRunStatus.RUNNING } });
    if ((abierta?.cursor ?? 0) >= matarEn) break;
    if (Date.now() - t0 > 60_000) throw new Error("el hijo no avanzo");
    await new Promise((r) => setTimeout(r, 100));
  }
  process.kill(-hijo.pid!, "SIGKILL");
  await new Promise((r) => setTimeout(r, 300));
  return (await prisma.syncRun.findFirstOrThrow({ where: { status: SyncRunStatus.RUNNING } })).cursor ?? 0;
}

async function main() {
  // Base de prueba limpia.
  await prisma.syncRun.deleteMany({});
  await prisma.productImage.deleteMany({});
  await prisma.productVariant.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.supplier.deleteMany({});
  const zecat = await levantarZecatFalso(estado);
  process.env.ZECAT_API_URL = zecat.url;

  try {
    console.log("=========== ENDPOINT: secreto, proveedor e interruptor ===========");
    delete process.env.CRON_SECRET;
    check("sin CRON_SECRET: 503", (await tickCron()).status === 503);
    process.env.CRON_SECRET = SECRET;
    check("header incorrecto: 401", (await tickCron("zecat", "Bearer otro")).status === 401);
    check("proveedor sin conector (otro): 404", (await tickCron("otro")).status === 404);
    const apagado = await tickCron();
    check("interruptor apagado: 200 skipped", (await apagado.json()).skipped === "disabled");
    check("interruptor apagado: no creo ninguna corrida ni mando mails", (await runs()).length === 0 && mails.length === 0);
    await prisma.supplier.create({ data: { origin: ProductOrigin.ZECAT, name: "Zecat", autoSyncEnabled: true } });

    console.log("\n=========== TICKS CON PRESUPUESTO DE 5 s ===========");
    process.env.SYNC_TICK_BUDGET_MS = "5000";
    estado.demoraDetalleMs = 700;
    const resultados: string[] = [];
    for (let i = 0; i < 30; i++) {
      const body = await (await tickCron()).json();
      resultados.push(body.tick.estado);
      if (body.tick.estado === "completa") break;
    }
    const [r1] = await runs();
    check("hicieron falta varios ticks", resultados.length > 2, resultados.join(","));
    check("la corrida la arranco el cron y termino DONE", r1.startedBy === "cron" && r1.status === SyncRunStatus.DONE);
    const vistos1 = r1.seenExternalIds as string[];
    check("vistos = total declarado, sin repetidos", vistos1.length === N && sinRepetidos(vistos1) && r1.totalRemote === N, `${vistos1.length}/${r1.totalRemote}`);
    check("lista congelada = el listado, cursor al final", (r1.plannedExternalIds as string[]).length === N && r1.cursor === N);
    check("cada producto se pidio UNA vez (ni salteado ni repetido)", ids.every((id) => estado.pedidosDetalle.get(id) === 1));
    check("100 creados, 0 fallidos, lease liberado", r1.created === N && r1.failed === 0 && r1.leaseUntil === null);

    console.log("\n=========== DOS LLAMADAS SIMULTANEAS + PANEL Y CRON INTERCALADOS ===========");
    await envejecerCompletas(7 * 3_600_000); // que el cron quiera arrancar
    estado.pedidosDetalle.clear();
    const [a, b] = await Promise.all([tickCron(), tickCron()]);
    const estados = [(await a.json()).tick.estado, (await b.json()).tick.estado].sort();
    check("dos ticks simultaneos: uno avanza y el otro responde 'ocupado'", estados.join() === "avanzo,ocupado", estados.join());
    const run2 = (await prisma.syncRun.findFirstOrThrow({ where: { status: SyncRunStatus.RUNNING } })).id;
    let turno = 0;
    let ultimo = "";
    while (ultimo !== "completa") {
      if (turno++ % 2 === 0) {
        const r = await avanzarCorrida(ProductOrigin.ZECAT, "admin@ejemplo.test", { esCron: false, siguiendo: run2 });
        ultimo = r.estado;
        if ("runId" in r) check("panel sobre la MISMA corrida", r.runId === run2);
      } else {
        const t = (await (await tickCron()).json()).tick;
        ultimo = t.estado;
        if (t.runId) check("cron sobre la MISMA corrida", t.runId === run2);
      }
      if (turno > 60) break;
    }
    const r2 = await prisma.syncRun.findUniqueOrThrow({ where: { id: run2 } });
    const vistos2 = r2.seenExternalIds as string[];
    check("intercalados: vistos = 100 sin repetidos, una sola corrida", vistos2.length === N && sinRepetidos(vistos2) && (await prisma.syncRun.count()) === 2);
    check("intercalados: startedBy sigue siendo quien la empezo (cron)", r2.startedBy === "cron");
    check("intercalados: cada producto pedido una vez", ids.every((id) => estado.pedidosDetalle.get(id) === 1));

    console.log("\n=========== MATAR EL PROCESO A MITAD DE UN TICK ===========");
    estado.demoraDetalleMs = 300;
    // Ticks cortos (~2 tandas) para que la corrida siga abierta entre muertes.
    process.env.SYNC_TICK_BUDGET_MS = "600";
    const despuesDeMatar = (n: number) => new Date(Date.now() + LEASE_MS + 1000 * n);
    const c1 = await tickHijoQueMuere(zecat.url, 15);
    const abierta = await prisma.syncRun.findFirstOrThrow({ where: { status: SyncRunStatus.RUNNING } });
    check("el hijo murio con el lease tomado", abierta.leaseUntil !== null && abierta.startedBy === "tick-hijo", `cursor ${c1}`);
    const sigue1 = await avanzarCorrida(ProductOrigin.ZECAT, "consola", { esCron: false, ahora: despuesDeMatar(1) });
    check("con el lease vigente nadie entra; vencido, el siguiente sigue", sigue1.estado === "avanzo" && sigue1.procesados > c1, `${c1} -> ${sigue1.estado === "avanzo" ? sigue1.procesados : sigue1.estado}`);
    check("una muerte: anotada, sin mail", mailsCon("se cortó dos veces") === 0);
    await tickHijoQueMuere(zecat.url, (sigue1.estado === "avanzo" ? sigue1.procesados : 0) + 10);
    await avanzarCorrida(ProductOrigin.ZECAT, "consola", { esCron: false, ahora: despuesDeMatar(2) });
    check("dos muertes sobre la misma corrida: UN mail", mailsCon("se cortó dos veces") === 1);
    const tercera = await prisma.syncRun.findFirstOrThrow({ where: { status: SyncRunStatus.RUNNING } });
    await tickHijoQueMuere(zecat.url, (tercera.cursor ?? 0) + 10);
    await avanzarCorrida(ProductOrigin.ZECAT, "consola", { esCron: false, ahora: despuesDeMatar(3) });
    check("tercera muerte: no repite el mail", mailsCon("se cortó dos veces") === 1);
    estado.demoraDetalleMs = 0;
    const fin3 = await correrHastaTerminar("consola");
    const r3 = await prisma.syncRun.findUniqueOrThrow({ where: { id: fin3.r.runId } });
    const vistos3 = r3.seenExternalIds as string[];
    const cortes = (r3.errors as Array<{ message: string }>).filter((e) => e.message.startsWith("Invocación cortada")).length;
    check("tras 3 muertes: vistos = 100, sin repetidos ni salteados", vistos3.length === N && sinRepetidos(vistos3) && ids.every((id) => vistos3.includes(id)));
    check("las 3 muertes quedaron anotadas en la corrida", cortes === 3, String(cortes));
    check("actualizados ~100 (+1 por muerte como maximo, ver motor.ts)", r3.updated >= N && r3.updated <= N + 3, String(r3.updated));

    console.log("\n=========== PRODUCTO QUE DESAPARECE A MITAD DE CORRIDA ===========");
    process.env.SYNC_TICK_BUDGET_MS = "2000";
    estado.demoraDetalleMs = 200;
    const t1 = await avanzarCorrida(ProductOrigin.ZECAT, "admin@ejemplo.test", { esCron: false });
    check("primer tick parcial", t1.estado === "avanzo" && t1.procesados < N);
    estado.detalle.set("c-099", "404"); // el ultimo de la lista, todavia no procesado
    estado.demoraDetalleMs = 0;
    const fin4 = await correrHastaTerminar("admin@ejemplo.test");
    const r4 = await prisma.syncRun.findUniqueOrThrow({ where: { id: fin4.r.runId } });
    const s4 = leerSummary(r4)!;
    check("el 404 no cuenta como fallido", r4.failed === 0);
    check("es ausente: fuera de vistos y en el resumen", !(r4.seenExternalIds as string[]).includes("c-099") && s4.ausentes.includes("c-099"));
    check("confirmado (404) y pausado", s4.autoPausados.includes("c-099") && !(await prisma.product.findUniqueOrThrow({ where: { zecatId: "c-099" } })).active);
    estado.detalle.delete("c-099");

    console.log("\n=========== API CAIDA: TOPE DE REINTENTOS Y UN SOLO MAIL ===========");
    await correrHastaTerminar("admin@ejemplo.test"); // vuelve c-099
    await revisarAlertas(ProductOrigin.ZECAT);
    await envejecerCompletas(7 * 3_600_000);
    estado.listadoCaido = true;
    const mailsAntes = mailsCon("la corrida falló");
    const intento1 = (await (await tickCron()).json()).tick;
    check("intento 1: falla al listar", intento1.estado === "fallo", intento1.mensaje ?? intento1.estado);
    const espera = (await (await tickCron()).json()).tick;
    check("enseguida: espera 10 min", espera.estado === "sin-corrida" && espera.motivo.includes("10 minutos"), espera.motivo);
    const pasarDiezMinutos = async () => {
      const ult = await prisma.syncRun.findFirstOrThrow({ where: { status: SyncRunStatus.FAILED }, orderBy: { finishedAt: "desc" } });
      await prisma.syncRun.update({ where: { id: ult.id }, data: { finishedAt: new Date(ult.finishedAt!.getTime() - 11 * 60_000) } });
    };
    await pasarDiezMinutos();
    check("intento 2: falla", (await (await tickCron()).json()).tick.estado === "fallo");
    await pasarDiezMinutos();
    check("intento 3: falla", (await (await tickCron()).json()).tick.estado === "fallo");
    await pasarDiezMinutos();
    const tope = (await (await tickCron()).json()).tick;
    check("cuarto: tope de 3 por ventana", tope.estado === "sin-corrida" && tope.motivo.includes("Tope"), tope.motivo);
    check("3 corridas de cron FAILED en la ventana", (await prisma.syncRun.count({ where: { startedBy: "cron", status: SyncRunStatus.FAILED } })) === 3);
    check("la racha de fallos: UN solo mail", mailsCon("la corrida falló") - mailsAntes === 1, String(mailsCon("la corrida falló") - mailsAntes));
    estado.listadoCaido = false;

    console.log("\n=========== RESUELTO Y VIGILANTE DE FRESCURA ===========");
    await correrHastaTerminar("admin@ejemplo.test");
    const res = await revisarAlertas(ProductOrigin.ZECAT);
    check("vuelve a OK: mail de 'resuelto'", res.accion === "resuelto" && mailsCon("resuelto") === 1, res.accion);
    // TODAS las corridas (completas y fallidas) a mas de 26 h. Si solo se
    // envejecen las completas, las FAILED del tope de arriba quedan "mas
    // nuevas" y el estado es FALLANDO, que tiene prioridad (medido).
    await envejecerTodas(27 * 3_600_000);
    const vieja = await vigilarFrescura(ProductOrigin.ZECAT);
    check("mas de 26 h sin completa: alerta de desactualizado", "estado" in vieja && vieja.estado === "DESACTUALIZADO" && mailsCon("26 horas") === 1);
    await vigilarFrescura(ProductOrigin.ZECAT);
    check("sigue igual: no repite (hasta el recordatorio de 72 h)", mailsCon("26 horas") === 1);
    await prisma.supplier.update({ where: { origin: ProductOrigin.ZECAT }, data: { autoSyncEnabled: false } });
    const apagadoV = await vigilarFrescura(ProductOrigin.ZECAT);
    check("con el sync automatico apagado, el vigilante no hace nada", apagadoV.accion === "nada" && mailsCon("26 horas") === 1);
    await prisma.supplier.update({ where: { origin: ProductOrigin.ZECAT }, data: { autoSyncEnabled: true } });
    await correrHastaTerminar("admin@ejemplo.test");
    const alDia = await revisarAlertas(ProductOrigin.ZECAT);
    check("una corrida nueva: resuelto del desactualizado", alDia.accion === "resuelto" && mailsCon("resuelto") === 2, alDia.accion);

    console.log("\n=========== CUATRO CORRIDAS CON EL MISMO BLOQUEO ===========");
    const fuera = ids.slice(80, 95); // 15 > umbral de 10
    estado.listado = ids.filter((id) => !fuera.includes(id));
    const bloqueoAntes = mailsCon("dejaron de venir");
    for (let i = 0; i < 4; i++) {
      await correrHastaTerminar("admin@ejemplo.test");
      await revisarAlertas(ProductOrigin.ZECAT);
    }
    check("4 corridas con el mismo bloqueo: UN mail", mailsCon("dejaron de venir") - bloqueoAntes === 1, String(mailsCon("dejaron de venir") - bloqueoAntes));
    estado.listado = estado.listado.filter((id) => id !== "c-079");
    await correrHastaTerminar("admin@ejemplo.test");
    await revisarAlertas(ProductOrigin.ZECAT);
    check("un ausente nuevo en el bloqueo: otro mail", mailsCon("dejaron de venir") - bloqueoAntes === 2);
    estado.listado = [...ids];
    const resueltosAntes = mailsCon("resuelto");
    await correrHastaTerminar("admin@ejemplo.test");
    const fin = await revisarAlertas(ProductOrigin.ZECAT);
    check("vuelven todos: mail de 'resuelto'", fin.accion === "resuelto" && mailsCon("resuelto") === resueltosAntes + 1, fin.accion);

    console.log("\n=========== LISTA VENCIDA ===========");
    const vieja6 = await prisma.syncRun.create({
      data: {
        provider: ProductOrigin.ZECAT,
        startedBy: "admin@ejemplo.test",
        startedAt: new Date(Date.now() - 7 * 3_600_000),
        plannedExternalIds: ids,
        cursor: 10,
      },
    });
    const tv = await avanzarCorrida(ProductOrigin.ZECAT, "admin@ejemplo.test", { esCron: false });
    const v6 = await prisma.syncRun.findUniqueOrThrow({ where: { id: vieja6.id } });
    check("la corrida vieja queda FAILED con 'lista vencida'", v6.status === SyncRunStatus.FAILED && (v6.errors as Array<{ message: string }>).some((e) => e.message.startsWith("Lista vencida")));
    check("y en el mismo tick arranca una nueva", tv.estado !== "sin-corrida" && "runId" in tv && tv.runId !== vieja6.id);
    await correrHastaTerminar("admin@ejemplo.test");

    console.log("\n=========== FENCING: UNA INVOCACION QUE SE CUELGA Y DESPIERTA TARDE ===========");
    // El hijo NO muere: se congela (SIGSTOP) con el lease tomado. Otro toma
    // la corrida (lease vencido), avanza, y el hijo despierta (SIGCONT): sus
    // escrituras tienen que rebotar.
    estado.demoraDetalleMs = 300;
    process.env.SYNC_TICK_BUDGET_MS = "600";
    const congelado = spawn("npx", ["tsx", "scripts/_tick-hijo.ts"], {
      env: { ...process.env, ZECAT_API_URL: zecat.url, SYNC_TICK_BUDGET_MS: "120000" },
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let salidaHijo = "";
    congelado.stdout!.on("data", (d) => (salidaHijo += String(d)));
    for (;;) {
      const ab = await prisma.syncRun.findFirst({ where: { status: SyncRunStatus.RUNNING } });
      if ((ab?.cursor ?? 0) >= 10) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    process.kill(-congelado.pid!, "SIGSTOP");
    const alCongelar = (await prisma.syncRun.findFirstOrThrow({ where: { status: SyncRunStatus.RUNNING } })).cursor ?? 0;
    const otro = await avanzarCorrida(ProductOrigin.ZECAT, "consola", { esCron: false, ahora: new Date(Date.now() + LEASE_MS + 5000) });
    const trasOtro = otro.estado === "avanzo" ? otro.procesados : -1;
    check("otro toma la corrida del colgado y avanza", trasOtro > alCongelar, `${alCongelar} -> ${trasOtro}`);
    process.kill(-congelado.pid!, "SIGCONT");
    const termino = await new Promise<boolean>((res) => {
      congelado.on("exit", () => res(true));
      setTimeout(() => res(false), 30_000);
    });
    const trasDespertar = await prisma.syncRun.findFirstOrThrow({ where: { startedBy: "tick-hijo" }, orderBy: { startedAt: "desc" } });
    check("el colgado despierta y sale sin escribir ('ocupado')", termino && salidaHijo.includes('"estado":"ocupado"'), salidaHijo.trim().slice(0, 80));
    check("el cursor nunca retrocede", (trasDespertar.cursor ?? 0) >= trasOtro, `${trasDespertar.cursor}`);
    estado.demoraDetalleMs = 0;
    const finF = await correrHastaTerminar("consola");
    const rF = await prisma.syncRun.findUniqueOrThrow({ where: { id: finF.r.runId } });
    const vistosF = rF.seenExternalIds as string[];
    check("fencing: vistos = 100 sin repetidos", vistosF.length === N && sinRepetidos(vistosF), String(vistosF.length));

    console.log("\n=========== ERROR TRANSITORIO: LA CORRIDA NO SE PIERDE ===========");
    // Un corte de la base al registrar un producto (simulado): la corrida
    // sigue RUNNING; el tercero seguido sobre el mismo cursor la cierra.
    process.env.SYNC_TICK_BUDGET_MS = "600";
    const original = prisma.$executeRaw.bind(prisma);
    let fallar = 0;
    (prisma as unknown as { $executeRaw: unknown }).$executeRaw = ((...args: unknown[]) => {
      if (fallar > 0) {
        fallar--;
        return Promise.reject(new Error("ECONNRESET simulado"));
      }
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as typeof prisma.$executeRaw;
    try {
      fallar = 1;
      const t = await avanzarCorrida(ProductOrigin.ZECAT, "admin@ejemplo.test", { esCron: false });
      const tr = await prisma.syncRun.findFirst({ where: { status: SyncRunStatus.RUNNING } });
      check("un error transitorio: la corrida sigue RUNNING", t.estado === "avanzo" && tr !== null, t.estado);
      check("y queda anotado", (tr?.errors as Array<{ message: string }>).some((e) => e.message.startsWith("Error transitorio")));
      const siguio = await avanzarCorrida(ProductOrigin.ZECAT, "admin@ejemplo.test", { esCron: false });
      // Sigue (o, sin demora, hasta completa): lo que importa es que no fallo.
      check("el tick siguiente sigue normalmente", siguio.estado === "avanzo" || siguio.estado === "completa", siguio.estado);
      fallar = 3;
      let ultimoT = "";
      for (let i = 0; i < 3; i++) ultimoT = (await avanzarCorrida(ProductOrigin.ZECAT, "admin@ejemplo.test", { esCron: false })).estado;
      check("tres seguidos sobre el mismo cursor: FAILED", ultimoT === "fallo" && (await prisma.syncRun.count({ where: { status: SyncRunStatus.RUNNING } })) === 0, ultimoT);
    } finally {
      (prisma as unknown as { $executeRaw: unknown }).$executeRaw = original;
    }
    await correrHastaTerminar("admin@ejemplo.test");

    console.log("\n=========== VENTANAS DE 30 MINUTOS ===========");
    const h = (iso: string, p: ProductOrigin = ProductOrigin.ZECAT) =>
      inicioDeVentana(new Date(iso), p).toISOString().slice(11, 16);
    check("Zecat: 09:00Z y 09:29Z son la ventana de las 09:00", h("2026-10-15T09:00:00Z") === "09:00" && h("2026-10-15T09:29:59Z") === "09:00");
    check("Zecat: 21:15Z es la ventana de las 21:00", h("2026-10-15T21:15:00Z") === "21:00");
    check("CDO: 10:00Z y 22:29Z son sus ventanas", h("2026-10-15T10:00:00Z", ProductOrigin.CDO) === "10:00" && h("2026-10-15T22:29:00Z", ProductOrigin.CDO) === "22:00");
    check("fuera de ventana (15:20Z): la hora en curso", h("2026-10-15T15:20:00Z") === "15:00");
    // vercel.json y VENTANAS_UTC tienen que decir lo mismo.
    const crons = (JSON.parse(fs.readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> }).crons;
    const esperado = (p: ProductOrigin) => {
      const v = VENTANAS_UTC[p]!;
      return `0-${v[0].minutos - 1} ${v.map((w) => w.desde).join(",")} * * *`;
    };
    check("vercel.json coincide con VENTANAS_UTC (Zecat)", crons.find((c) => c.path === "/api/cron/sync/zecat")?.schedule === esperado(ProductOrigin.ZECAT), esperado(ProductOrigin.ZECAT));
    check("vercel.json coincide con VENTANAS_UTC (CDO)", crons.find((c) => c.path === "/api/cron/sync/cdo")?.schedule === esperado(ProductOrigin.CDO), esperado(ProductOrigin.CDO));

    console.log("\n=========== ALERTAS: CONCURRENCIA Y SIN CONFIGURAR ===========");
    estado.listado = ids.filter((id) => !ids.slice(0, 20).includes(id)); // bloqueo nuevo
    await correrHastaTerminar("admin@ejemplo.test");
    const antesC = mailsCon("dejaron de venir");
    const [x, y] = await Promise.all([revisarAlertas(ProductOrigin.ZECAT), revisarAlertas(ProductOrigin.ZECAT)]);
    check("dos revisarAlertas simultaneos: UN mail", mailsCon("dejaron de venir") - antesC === 1, `${x.accion}/${y.accion}`);
    estado.listado = [...ids];
    await correrHastaTerminar("admin@ejemplo.test");
    delete process.env.ALERT_EMAIL;
    const antesSin = mails.length;
    const sin = await revisarAlertas(ProductOrigin.ZECAT);
    check("sin ALERT_EMAIL: no se intenta (ni se marca)", sin.accion === "nada" && mails.length === antesSin);
    process.env.ALERT_EMAIL = "alertas@ejemplo.test";
    const conConfig = await revisarAlertas(ProductOrigin.ZECAT);
    check("configurada de nuevo: avisa lo pendiente (resuelto)", conConfig.accion === "resuelto", conConfig.accion);

    console.log("\n=========== INTERRUPTOR APAGADO CON TODO ANDANDO ===========");
    await prisma.supplier.update({ where: { origin: ProductOrigin.ZECAT }, data: { autoSyncEnabled: false } });
    await envejecerCompletas(7 * 3_600_000);
    const antesRuns = await prisma.syncRun.count();
    const antesMails = mails.length;
    const off = await (await tickCron()).json();
    check("apagado: skipped, sin corridas nuevas ni mails", off.skipped === "disabled" && (await prisma.syncRun.count()) === antesRuns && mails.length === antesMails);
  } finally {
    await zecat.cerrar();
  }
}

main()
  .catch((e) => {
    fallos++;
    console.error("TIRO:", e);
  })
  .finally(async () => {
    console.log(`\nMails interceptados (ninguno salio): ${mails.length}`);
    console.log(fallos ? `\n${fallos} chequeo(s) fallaron.` : "\nTodos los chequeos pasan.");
    process.exitCode = fallos ? 1 : 0;
    await prisma.$disconnect();
  });

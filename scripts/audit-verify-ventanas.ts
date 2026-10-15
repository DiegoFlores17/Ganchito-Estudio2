// Verificacion de las ventanas de 30 minutos del cron (2026-10-15), con el
// reloj SIMULADO (avanzarCorrida acepta `ahora`) y un Zecat falso. Corre SOLO
// contra la base de prueba de la etapa C:
//
//   DATABASE_URL=postgresql://…@localhost:5432/ganchito_estudio_c_test \
//     npx tsx scripts/audit-verify-ventanas.ts
//
// Tres casos:
// 1. Peor caso de reintentos: el proveedor caido toda la ventana.
// 2. Una corrida que no termina en su ventana.
// 3. La primera corrida de CDO desde el panel (fuera de ventana), y que pasa
//    si se cierra la pestaña a mitad de camino.
//
// Borra las corridas de la base de prueba al empezar.
import "dotenv/config";
import { ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { avanzarCorrida, inicioDeVentana, LISTA_VENCE_MS, VENTANAS_UTC } from "../src/lib/sync/motor";
import { levantarZecatFalso, type EstadoFalso } from "./_zecat-falso";

const db = new URL(process.env.DATABASE_URL ?? "postgres://x");
if (db.hostname !== "localhost" || !db.pathname.endsWith("_c_test")) {
  console.error(`ABORTADO: este script solo corre contra la base *_c_test en localhost (vino ${db.hostname}${db.pathname}).`);
  process.exit(1);
}
process.env.ZECAT_API_TOKEN = "falso";
delete process.env.RESEND_API_KEY;
delete process.env.ALERT_EMAIL;

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

// Los MISMOS ids que la regresion de C (misma base): con otros, la guarda
// de cordura del cierre ve un catalogo que no coincide con los activos y
// aborta la corrida (con razon).
const N = 100;
const ids = Array.from({ length: N }, (_, i) => `c-${String(i).padStart(3, "0")}`);
const estado: EstadoFalso = {
  listado: [...ids],
  detalle: new Map(),
  demoraDetalleMs: 0,
  listadoCaido: false,
  pedidosDetalle: new Map(),
};

const MIN = 60_000;
const zecatRuns = () =>
  prisma.syncRun.findMany({ where: { provider: ProductOrigin.ZECAT }, orderBy: { startedAt: "asc" } });

/// Lleva las fechas de una corrida al reloj simulado (el motor las escribe
/// con la hora real).
async function aRelojSimulado(id: string, startedAt: Date, finishedAt: Date | null) {
  await prisma.syncRun.update({ where: { id }, data: { startedAt, finishedAt } });
}

/// Una corrida DONE vieja: el cron solo arranca si la ultima completa tiene
/// mas de 6 h.
async function completaVieja(hace: Date) {
  await prisma.syncRun.create({
    data: {
      provider: ProductOrigin.ZECAT,
      status: SyncRunStatus.DONE,
      startedBy: "cron",
      startedAt: hace,
      finishedAt: hace,
      heartbeatAt: hace,
    },
  });
}

async function main() {
  const zecat = await levantarZecatFalso(estado);
  process.env.ZECAT_API_URL = zecat.url;
  try {
    await prisma.syncRun.deleteMany({});
    // Restos de una version anterior de este script, con otros ids.
    await prisma.product.deleteMany({ where: { origin: ProductOrigin.ZECAT, zecatId: { startsWith: "v-" } } });

    // Una ventana real de Zecat, en una fecha futura (sin choques con la hora
    // real de la maquina).
    const v = VENTANAS_UTC[ProductOrigin.ZECAT]![0];
    const T0 = new Date(Date.UTC(2030, 0, 10, v.desde, 0, 0));
    check("la ventana de Zecat dura 30 minutos", v.minutos === 30, `${v.desde}:00Z + ${v.minutos} min`);

    console.log("\n=========== 1. PEOR CASO DE REINTENTOS: PROVEEDOR CAIDO TODA LA VENTANA ===========");
    await completaVieja(new Date(T0.getTime() - 20 * 60 * MIN));
    estado.listadoCaido = true;
    const intentos: number[] = [];
    const motivos = new Map<string, number>();
    for (let m = 0; m < v.minutos; m++) {
      const ahora = new Date(T0.getTime() + m * MIN);
      const antes = new Set((await zecatRuns()).map((x) => x.id));
      const r = await avanzarCorrida(ProductOrigin.ZECAT, "cron", { esCron: true, ahora });
      const nuevas = (await zecatRuns()).filter((x) => !antes.has(x.id));
      for (const n of nuevas) {
        // La corrida falla en el acto (la lista no se puede armar): se lleva
        // al minuto simulado.
        await aRelojSimulado(n.id, ahora, ahora);
        intentos.push(m);
      }
      if (r.estado === "sin-corrida") motivos.set(r.motivo, (motivos.get(r.motivo) ?? 0) + 1);
    }
    estado.listadoCaido = false;
    console.log(`  intentos en los minutos: ${intentos.join(", ")}`);
    for (const [motivo, n] of motivos) console.log(`  ${n} tick(s) sin arrancar: ${motivo}`);
    check("3 intentos, en los minutos 0, 10 y 20", JSON.stringify(intentos) === "[0,10,20]", intentos.join(","));
    check("despues del tercero, el tope (y no un cuarto)", [...motivos.keys()].some((k) => k.startsWith("Tope de 3")));
    check("entre intentos, la espera de 10 minutos", [...motivos.keys()].some((k) => k.startsWith("Esperando 10 minutos")));
    const fallidas = (await zecatRuns()).filter((r) => r.status === SyncRunStatus.FAILED);
    check("las 3 quedan FAILED, ninguna RUNNING", fallidas.length === 3 && !(await zecatRuns()).some((r) => r.status === SyncRunStatus.RUNNING));

    console.log("\n=========== 2. UNA CORRIDA QUE NO TERMINA EN SU VENTANA ===========");
    await prisma.syncRun.deleteMany({});
    const T1 = new Date(T0.getTime() + 24 * 60 * MIN); // la ventana de las 09:00Z del dia siguiente
    await completaVieja(new Date(T1.getTime() - 20 * 60 * MIN));
    // Un tick corto: la corrida arranca y queda a medias, como si el
    // proveedor estuviera lento hasta que cierra la ventana.
    process.env.SYNC_TICK_BUDGET_MS = "1";
    estado.demoraDetalleMs = 30;
    const r1 = await avanzarCorrida(ProductOrigin.ZECAT, "cron", { esCron: true, ahora: T1 });
    estado.demoraDetalleMs = 0;
    check("arranca y queda a medias", r1.estado === "avanzo" && r1.procesados < N, r1.estado === "avanzo" ? `${r1.procesados} de ${r1.total}` : r1.estado);
    const aMedias = (await zecatRuns()).find((r) => r.status === SyncRunStatus.RUNNING)!;
    await aRelojSimulado(aMedias.id, T1, null);
    await prisma.syncRun.update({ where: { id: aMedias.id }, data: { leaseUntil: null } });

    // Fuera de ventana el cron no dispara (vercel.json): lo siguiente que la
    // toca es la ventana de 12 h despues.
    const T2 = new Date(Date.UTC(2030, 0, 11, VENTANAS_UTC[ProductOrigin.ZECAT]![1].desde, 0, 0));
    check("la ventana siguiente es 12 h despues", T2.getTime() - T1.getTime() === 12 * 60 * MIN);
    check("12 h > vencimiento de la lista (6 h)", T2.getTime() - T1.getTime() > LISTA_VENCE_MS);
    delete process.env.SYNC_TICK_BUDGET_MS;
    const r2 = await avanzarCorrida(ProductOrigin.ZECAT, "cron", { esCron: true, ahora: T2 });
    const tras = await zecatRuns();
    const vieja = tras.find((r) => r.id === aMedias.id)!;
    const notaVieja = (vieja.errors as Array<{ message: string }>).at(-1)?.message ?? "";
    check("la vieja se cierra FAILED por lista vencida", vieja.status === SyncRunStatus.FAILED && notaVieja.startsWith("Lista vencida"), notaVieja.slice(0, 60));
    const nueva = tras.find((r) => r.id !== aMedias.id && r.status !== SyncRunStatus.DONE || (r.id !== aMedias.id && r.startedBy === "cron" && r.startedAt.getTime() > T1.getTime()));
    check("en el MISMO tick arranca una nueva y avanza", !!nueva && nueva.id !== aMedias.id && (r2.estado === "avanzo" || r2.estado === "completa"), r2.estado === "fallo" ? r2.mensaje : r2.estado);
    // La nueva cuenta como intento 1 de esta ventana: quedan 2 si falla.
    if (nueva) await aRelojSimulado(nueva.id, T2, nueva.finishedAt ? T2 : null);
    const enVentana = (await zecatRuns()).filter(
      (r) => r.startedBy === "cron" && r.startedAt.getTime() >= inicioDeVentana(T2, ProductOrigin.ZECAT).getTime()
    );
    check("la vencida NO consume intentos de la ventana nueva", enVentana.length === 1, `${enVentana.length} en la ventana`);

    console.log("\n=========== 3. PRIMERA CORRIDA DESDE EL PANEL, FUERA DE VENTANA ===========");
    await prisma.syncRun.deleteMany({});
    // 14:00 ART = 17:00Z: fuera de toda ventana, y con una completa de hace
    // 1 h (el panel no mira la regla de 6 h: lo dispara una persona).
    const T3 = new Date(Date.UTC(2030, 0, 12, 17, 0, 0));
    await completaVieja(new Date(T3.getTime() - 60 * MIN));
    check("17:00Z esta fuera de las ventanas de CDO", !VENTANAS_UTC[ProductOrigin.CDO]!.some((w) => w.desde === 17));
    process.env.SYNC_TICK_BUDGET_MS = "1";
    estado.demoraDetalleMs = 30;
    const p1 = await avanzarCorrida(ProductOrigin.ZECAT, "admin@ejemplo.test", { esCron: false, ahora: T3 });
    check("el panel arranca igual (sin ventana ni regla de 6 h)", p1.estado === "avanzo", p1.estado);
    const delPanel = (await zecatRuns()).find((r) => r.status === SyncRunStatus.RUNNING)!;
    await aRelojSimulado(delPanel.id, T3, null);
    await prisma.syncRun.update({ where: { id: delPanel.id }, data: { leaseUntil: null } });
    // "Se cerro la pestaña". Con el interruptor encendido, la ventana
    // siguiente del cron dentro de las 6 h la retoma; mas tarde, se vence.
    const dentro = new Date(T3.getTime() + 5 * 60 * MIN);
    delete process.env.SYNC_TICK_BUDGET_MS;
    estado.demoraDetalleMs = 0;
    const c1 = await avanzarCorrida(ProductOrigin.ZECAT, "cron", { esCron: true, ahora: dentro });
    check("dentro de 6 h, el cron RETOMA la del panel (no arranca otra)", "runId" in c1 && c1.runId === delPanel.id, c1.estado === "fallo" ? c1.mensaje : c1.estado);
    const fin = await prisma.syncRun.findUniqueOrThrow({ where: { id: delPanel.id } });
    check("y la termina, con startedBy del panel", fin.status === SyncRunStatus.DONE && fin.startedBy === "admin@ejemplo.test", `${fin.status} ${fin.startedBy}`);
    const total = (await zecatRuns()).filter((r) => r.startedBy === "cron" && r.startedAt.getTime() >= T3.getTime()).length;
    check("retomar no cuenta como intento del cron", total === 0, `${total}`);
  } finally {
    delete process.env.SYNC_TICK_BUDGET_MS;
    await zecat.cerrar();
  }
}

main()
  .catch((e) => {
    fallos++;
    console.error("TIRO:", e);
  })
  .finally(async () => {
    console.log(fallos ? `\n${fallos} chequeo(s) fallaron.` : "\nTodos los chequeos pasan.");
    process.exitCode = fallos ? 1 : 0;
    await prisma.$disconnect();
  });

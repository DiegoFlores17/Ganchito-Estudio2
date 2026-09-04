// Verificacion del lock y el retome de SyncRun contra la base LOCAL.
import "dotenv/config";
import { ProductOrigin } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { acquireSyncRun, recordBatch, finishSyncRun, SyncLockError, HEARTBEAT_STALE_MS } from "../src/lib/sync-run";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost")) throw new Error("ABORTADO: no es local");
  await prisma.syncRun.deleteMany({}); // arranque limpio para el test

  // 1. Acquire + doble-start rechazado.
  const run = await acquireSyncRun(ProductOrigin.ZECAT, "test@local");
  let rechazado = false;
  try { await acquireSyncRun(ProductOrigin.ZECAT, "otro@local"); } catch (e) { rechazado = e instanceof SyncLockError; }
  console.log("[lock] doble-start rechazado:", rechazado);

  // 2. Carrera real contra el indice parcial: dos creates directos.
  let carreraGano1 = false;
  try {
    await prisma.syncRun.create({ data: { provider: ProductOrigin.ZECAT, startedBy: "carrera" } });
  } catch { carreraGano1 = true; }
  console.log("[lock] el indice parcial corta el insert directo:", carreraGano1);

  // 3. Progreso acumulado.
  await recordBatch(run.id, { cursor: 1, totalRemote: 30, counters: { created: 1, updated: 9, paused: 0, failed: 0, usdWarnings: 2 }, seenExternalIds: ["a","b"], errors: [] });
  const r2 = await recordBatch(run.id, { cursor: 2, counters: { created: 0, updated: 10, paused: 1, failed: 1, usdWarnings: 0 }, seenExternalIds: ["c"], errors: [{ externalId: "x", message: "prueba" }] });
  console.log("[progreso] acumula:", r2.created === 1 && r2.updated === 19 && r2.paused === 1 && (r2.seenExternalIds as string[]).length === 3, "| cursor:", r2.cursor);

  // 4. Muerta -> se retoma con cursor y contadores.
  await prisma.syncRun.update({ where: { id: run.id }, data: { heartbeatAt: new Date(Date.now() - HEARTBEAT_STALE_MS - 1000) } });
  const retomada = await acquireSyncRun(ProductOrigin.ZECAT, "retomador@local");
  console.log("[retome] misma corrida:", retomada.id === run.id, "| desde cursor:", retomada.cursor, "| contadores conservados:", retomada.updated === 19);

  // 5. Finish calcula ausentes: ids vistos a/b/c no matchean ningun zecatId
  //    real, asi que TODOS los activos deberian aparecer como ausentes.
  const done = await finishSyncRun(run.id);
  const activos = await prisma.product.count({ where: { origin: "ZECAT", active: true, deletedAt: null } });
  console.log("[ausentes] detectados:", (done.missingExternalIds as string[]).length, "| activos en base:", activos, "| coinciden:", (done.missingExternalIds as string[]).length === activos);

  await prisma.syncRun.deleteMany({}); // limpiar el test
  console.log("[limpieza] tabla vacia:", await prisma.syncRun.count() === 0);
}
main().finally(() => prisma.$disconnect());

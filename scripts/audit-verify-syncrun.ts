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

  // 5. GUARDA DE CORDURA: vistos (3) << activos -> la corrida se aborta
  //    FAILED sin calcular ausencia.
  const fin5 = await finishSyncRun(run.id);
  console.log("[cordura] aborta con respuesta anomala:", fin5.aborted === true, "| status:", fin5.run.status);

  // Datos para los casos siguientes: todos los zecatIds activos.
  const activos = await prisma.product.findMany({
    where: { origin: "ZECAT", active: true, deletedAt: null, zecatId: { not: null } },
    select: { zecatId: true },
  });
  const todos = activos.map((a) => a.zecatId!);

  // 6. UMBRAL: faltan 50 (> max(10, 5% de ~656 = 32)) -> DONE con
  //    autoPauseSkipped, sin pausar NINGUNO.
  const run6 = await acquireSyncRun(ProductOrigin.ZECAT, "test-umbral@local");
  await recordBatch(run6.id, { cursor: 1, counters: { created: 0, updated: 0, paused: 0, failed: 0, usdWarnings: 0 }, seenExternalIds: todos.slice(50), errors: [] });
  const fin6 = await finishSyncRun(run6.id);
  const activosDespues6 = await prisma.product.count({ where: { origin: "ZECAT", active: true, deletedAt: null } });
  console.log("[umbral] skipped:", !fin6.aborted && fin6.run.autoPauseSkipped, "| missing:", !fin6.aborted && (fin6.run.missingExternalIds as string[]).length, "| autoPaused:", !fin6.aborted && (fin6.run.autoPausedExternalIds as string[]).length, "| nadie pausado:", activosDespues6 === todos.length);

  // 7. AUTO-PAUSADO: faltan 3 (<= umbral) -> se pausan, quedan registrados.
  const faltantes = todos.slice(0, 3);
  const run7 = await acquireSyncRun(ProductOrigin.ZECAT, "test-autopausa@local");
  await recordBatch(run7.id, { cursor: 1, counters: { created: 0, updated: 0, paused: 0, failed: 0, usdWarnings: 0 }, seenExternalIds: todos.slice(3), errors: [] });
  const fin7 = await finishSyncRun(run7.id);
  const pausadosAhora = await prisma.product.count({ where: { origin: "ZECAT", active: false, zecatId: { in: faltantes } } });
  console.log("[autopausa] pausados en base:", pausadosAhora === 3, "| registrados:", !fin7.aborted && JSON.stringify(fin7.run.autoPausedExternalIds) === JSON.stringify(faltantes), "| skipped false:", !fin7.aborted && fin7.run.autoPauseSkipped === false);

  // 8. Supplier creado on-demand con el default.
  const sup = await prisma.supplier.findUnique({ where: { origin: ProductOrigin.ZECAT } });
  console.log("[supplier] fila on-demand:", sup?.name === "Zecat", "| umbral %:", Number(sup?.autoPauseMaxPercent) === 5);

  // Revertir el auto-pausado del test para dejar local como estaba.
  await prisma.product.updateMany({ where: { zecatId: { in: faltantes } }, data: { active: true } });
  console.log("[revert] reactivados:", await prisma.product.count({ where: { origin: "ZECAT", active: true, deletedAt: null } }) === todos.length);

  await prisma.syncRun.deleteMany({}); // limpiar el test
  console.log("[limpieza] tabla vacia:", await prisma.syncRun.count() === 0);
}
main().finally(() => prisma.$disconnect());

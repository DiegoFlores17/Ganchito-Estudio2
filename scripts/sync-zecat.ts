import "dotenv/config";
import { ProductOrigin } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { syncZecatBatch } from "../src/lib/zecat/sync";
import {
  acquireSyncRun,
  failSyncRun,
  finishSyncRun,
  recordBatch,
  SyncLockError,
} from "../src/lib/sync-run";

// Mismo camino de codigo que el boton del panel: batches + SyncRun. Eso
// hace que la consola RESPETE EL LOCK — si alguien esta sincronizando desde
// el panel, este script se niega a arrancar en vez de pisarlo (y viceversa).
const BATCH_LIMIT = 25; // en consola no hay limite de duracion por batch

async function main() {
  console.log("Iniciando sincronizacion con Zecat...");
  const start = Date.now();

  let run;
  try {
    run = await acquireSyncRun(ProductOrigin.ZECAT, "consola");
  } catch (error) {
    if (error instanceof SyncLockError) {
      console.error(`ABORTADO: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // Retome: si la corrida venia de antes (muerta y retomada), arranca de la
  // pagina siguiente a la ultima completada. Ojo: el cursor es en paginas
  // del MISMO limit; la consola y el panel usan limits distintos, asi que
  // una corrida del panel retomada por consola re-procesa algo — inocuo,
  // el upsert es idempotente.
  let page = (run.cursor ?? 0) + 1;
  if (run.cursor) {
    console.log(`Retomando corrida ${run.id} desde la pagina ${page}...`);
  }

  try {
    for (;;) {
      const batch = await syncZecatBatch(page, BATCH_LIMIT);
      run = await recordBatch(run.id, {
        cursor: page,
        totalRemote: batch.totalRemote,
        counters: batch.counters,
        seenExternalIds: batch.seenExternalIds,
        errors: batch.errors,
      });
      console.log(
        `  pagina ${page}/${batch.totalPages} — creados ${run.created}, actualizados ${run.updated}, pausados ${run.paused}, fallidos ${run.failed}`
      );
      if (batch.isLast) break;
      page++;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failSyncRun(run.id, message);
    console.error(`\nCorrida FALLIDA (queda retomable via SyncRun): ${message}`);
    process.exitCode = 1;
    return;
  }

  const done = await finishSyncRun(run.id);
  const elapsedSeconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\nResumen de la sincronizacion:");
  console.log(`  Vistos:           ${(done.seenExternalIds as string[]).length}`);
  console.log(`  Creados:          ${done.created}`);
  console.log(`  Actualizados:     ${done.updated}`);
  console.log(`  Pausados:         ${done.paused}`);
  console.log(`  Fallidos:         ${done.failed}`);
  console.log(`  Currency "USD":   ${done.usdWarnings}`);
  console.log(`  Tiempo:           ${elapsedSeconds}s`);

  const missing = done.missingExternalIds as string[];
  if (missing.length) {
    console.log(
      `\nAUSENTES: ${missing.length} producto(s) activos que la API ya no devuelve (candidatos a zombie):`
    );
    for (const id of missing) console.log(`  - ${id}`);
  }

  const errors = done.errors as Array<{ externalId: string; message: string }>;
  if (errors.length) {
    console.log("\nErrores:");
    for (const e of errors) console.log(`  - producto ${e.externalId}: ${e.message}`);
  }

  if (done.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

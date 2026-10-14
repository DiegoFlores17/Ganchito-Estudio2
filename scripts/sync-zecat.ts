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
import { sendSyncAlert } from "../src/lib/email";

// Mismo camino de codigo que el boton del panel: batches + SyncRun. Eso
// hace que la consola RESPETE EL LOCK — si alguien esta sincronizando desde
// el panel, este script se niega a arrancar en vez de pisarlo (y viceversa).
const BATCH_LIMIT = 25; // en consola no hay limite de duracion por batch

/// La consola lee el .env LOCAL, que a proposito no tiene las credenciales
/// de Resend de produccion (un secreto mas dando vueltas, para un camino que
/// con el cron pasa a ser excepcional). Consecuencia: una corrida de consola
/// contra produccion NO manda alertas. Se avisa a la vista, al arrancar, en
/// vez de dejarlo implicito en un log de "Falta ALERT_EMAIL" que aparece
/// recien cuando algo ya salio mal.
function avisarSiNoHayAlertas() {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  const esLocal = host === "localhost" || host === "127.0.0.1";
  const faltan = [
    !process.env.RESEND_API_KEY && "RESEND_API_KEY",
    !process.env.ALERT_EMAIL && "ALERT_EMAIL",
  ].filter(Boolean);
  if (esLocal || faltan.length === 0) return;

  console.warn(
    "\n" +
      "==============================================================\n" +
      "  ESTA CORRIDA NO ENVÍA ALERTAS POR MAIL\n" +
      `  Base: ${host} (no es local). Falta: ${faltan.join(", ")}.\n` +
      "  Si el umbral frena el pausado o la corrida falla, solo queda\n" +
      "  en esta consola y en el historial del panel.\n" +
      "==============================================================\n"
  );
}

async function main() {
  console.log("Iniciando sincronizacion con Zecat...");
  avisarSiNoHayAlertas();
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
    // Mismo aviso que el camino del panel (proveedores/actions.ts). Sin
    // credenciales en el entorno, solo loguea — ver avisarSiNoHayAlertas.
    await sendSyncAlert({
      provider: ProductOrigin.ZECAT,
      motivo: "fallo",
      detalle: `La corrida se cortó con: ${message}`,
      runId: run.id,
    });
    console.error(`\nCorrida FALLIDA (queda retomable via SyncRun): ${message}`);
    process.exitCode = 1;
    return;
  }

  const fin = await finishSyncRun(run.id);
  if (fin.aborted) {
    console.error("\nCorrida ABORTADA: respuesta anomala del proveedor (ver SyncRun.errors). No se pauso nada.");
    process.exitCode = 1;
    return;
  }
  const { run: done, pausedMissingExternalIds, variantesDesactivadas, productosSinVariantes } = fin;
  const elapsedSeconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\nResumen de la sincronizacion:");
  console.log(`  Vistos:           ${(done.seenExternalIds as string[]).length}`);
  console.log(`  Creados:          ${done.created}`);
  console.log(`  Actualizados:     ${done.updated}`);
  console.log(`  Pausados:         ${done.paused}`);
  console.log(`  Fallidos:         ${done.failed}`);
  console.log(`  Variantes desact: ${variantesDesactivadas} (el proveedor dejo de mandarlas)`);
  console.log(`  Sin variantes:    ${productosSinVariantes} producto(s), quedan inactivos`);
  console.log(`  Currency "USD":   ${done.usdWarnings}`);
  console.log(`  Tiempo:           ${elapsedSeconds}s`);

  const missing = done.missingExternalIds as string[];
  if (missing.length) {
    const auto = done.autoPausedExternalIds as string[];
    console.log(`\nAUSENTES: ${missing.length} producto(s) que la API ya no devuelve:`);
    for (const id of missing) console.log(`  - ${id}${auto.includes(id) ? " (pausado automaticamente)" : ""}`);
    if (done.autoPauseSkipped) {
      console.log(
        `UMBRAL DE SEGURIDAD: ${missing.length} ausentes superan el limite — NO se pauso ninguno. Revisar manualmente.`
      );
    }
  }
  if (pausedMissingExternalIds.length) {
    console.log(
      `Ya pausados que siguen fuera de la API: ${pausedMissingExternalIds.length} (${pausedMissingExternalIds.join(", ")})`
    );
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

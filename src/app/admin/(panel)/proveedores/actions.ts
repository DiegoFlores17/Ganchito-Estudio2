"use server";

import { ProductOrigin, SyncRunStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSuperAdmin } from "@/lib/admin-auth";
import { syncZecatBatch } from "@/lib/zecat/sync";
import {
  acquireSyncRun,
  failSyncRun,
  finishSyncRun,
  pausarAusentesDeCorrida,
  recordBatch,
  SyncLockError,
  type SyncRunSummary,
} from "@/lib/sync-run";
import { sendSyncAlert, type EnvioResultado } from "@/lib/email";

/// Manda una alerta de prueba REAL a ALERT_EMAIL. Existe para poder
/// verificar la cadena entera (variable, API key, dominio, bandeja) sin
/// esperar a un incidente: la primera alerta real del umbral llego y no se
/// vio, y no habia forma de probarla a voluntad.
///
/// Solo super-admin: manda un mail de verdad, y quien recibe las alertas es
/// configuracion tecnica, no operacion del dia a dia.
export async function sendTestSyncAlert(): Promise<EnvioResultado> {
  const admin = await requireSuperAdmin();
  return sendSyncAlert({
    motivo: "prueba",
    provider: ProductOrigin.ZECAT,
    pedidoPor: admin.email,
  });
}

/// Batch chico a proposito: cada invocacion tiene que quedar lejos del
/// limite de duracion de Vercel. El navegador conduce el loop.
const BATCH_LIMIT = 10;

export interface SyncProgress {
  runId: string;
  done: boolean;
  page: number;
  totalPages: number | null;
  totalRemote: number | null;
  created: number;
  updated: number;
  paused: number;
  failed: number;
  usdWarnings: number;
  /// Solo cuando done: el resumen fijo de la corrida, el MISMO que guarda
  /// SyncRun.summary y lee el historial. La card y la fila no pueden decir
  /// cosas distintas porque leen lo mismo.
  summary?: SyncRunSummary;
  errors: Array<{ externalId: string; message: string }>;
}

export interface StartSyncResult {
  success: boolean;
  error?: string;
  runId?: string;
  /// Pagina desde la que arranca el loop (1, o cursor+1 si se retoma).
  nextPage?: number;
  resumed?: boolean;
}

/// Toma el lock (o retoma una corrida muerta) y devuelve desde donde seguir.
/// El lock real es el indice unico parcial de la base — el disabled del
/// boton es UX, nunca seguridad.
export async function startSync(
  provider: ProductOrigin
): Promise<StartSyncResult> {
  const admin = await requireAdmin();

  // v1: solo Zecat corre. La firma ya es agnostica para no re-disenar
  // cuando se sume CDO.
  if (provider !== ProductOrigin.ZECAT) {
    return { success: false, error: "Proveedor todavía no soportado." };
  }

  try {
    const run = await acquireSyncRun(provider, admin.email);
    return {
      success: true,
      runId: run.id,
      nextPage: (run.cursor ?? 0) + 1,
      resumed: run.cursor !== null,
    };
  } catch (error) {
    if (error instanceof SyncLockError) {
      return { success: false, error: error.message };
    }
    throw error;
  }
}

/// Procesa UNA pagina del proveedor y registra el avance. El cliente la
/// llama en loop hasta done: true.
export async function advanceSync(
  runId: string,
  page: number
): Promise<SyncProgress> {
  await requireAdmin();

  const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
  const provider = run.provider;
  if (run.status !== SyncRunStatus.RUNNING) {
    throw new Error("La corrida ya no está activa.");
  }

  try {
    const batch = await syncZecatBatch(page, BATCH_LIMIT);
    const updated = await recordBatch(runId, {
      cursor: page,
      totalRemote: batch.totalRemote,
      counters: batch.counters,
      seenExternalIds: batch.seenExternalIds,
      errors: batch.errors,
    });

    if (batch.isLast) {
      const fin = await finishSyncRun(runId);
      if (fin.aborted) {
        throw new Error(
          "La sincronización se abortó: el proveedor devolvió una respuesta anómala (muy pocos productos). No se pausó nada — reintentá más tarde."
        );
      }
      const { run: done, summary } = fin;
      // Los costos pueden haber cambiado: el catalogo publico se refresca.
      revalidatePath("/catalogo");
      revalidatePath("/");
      return {
        runId,
        done: true,
        page,
        totalPages: batch.totalPages,
        totalRemote: done.totalRemote,
        created: done.created,
        updated: done.updated,
        paused: done.paused,
        failed: done.failed,
        usdWarnings: done.usdWarnings,
        summary,
        errors: done.errors as Array<{ externalId: string; message: string }>,
      };
    }

    return {
      runId,
      done: false,
      page,
      totalPages: batch.totalPages,
      totalRemote: updated.totalRemote,
      created: updated.created,
      updated: updated.updated,
      paused: updated.paused,
      failed: updated.failed,
      usdWarnings: updated.usdWarnings,
      errors: updated.errors as Array<{ externalId: string; message: string }>,
    };
  } catch (error) {
    // Error del LOOP (la API de Zecat caida, la base inaccesible) — no de
    // un producto puntual, esos ya quedaron en errors y la corrida siguio.
    const message = error instanceof Error ? error.message : String(error);
    await failSyncRun(runId, message);
    // Con el boton hay alguien mirando la pantalla, pero el cron va a usar
    // este mismo camino sin nadie delante: el mail es lo que hace que una
    // corrida fallida no pase desapercibida.
    await sendSyncAlert({
      provider,
      motivo: "fallo",
      detalle: `La corrida se cortó con: ${message}`,
      runId,
    });
    throw new Error(`La sincronización falló: ${message}`);
  }
}

export interface PausarAusentesResult {
  success: boolean;
  error?: string;
  pausados?: number;
  aRevisar?: number;
  noVerificados?: number;
  /// Pendientes que superaron el tope de este click: quedan para el proximo.
  restantes?: number;
}

/// "Pausar estos N" de una corrida con el umbral frenado. Cualquier admin:
/// es la misma operacion que el auto-pausado (aplica la verdad del
/// proveedor y es reversible), solo que con una persona decidiendo. Antes
/// de pausar, cada ausente se vuelve a confirmar contra el proveedor — ver
/// pausarAusentesDeCorrida en lib/sync-run.ts.
export async function pausarAusentes(runId: string): Promise<PausarAusentesResult> {
  // Gate propio: una Server Action es un endpoint, se puede invocar sin
  // pasar por la pantalla.
  const admin = await requireAdmin();
  try {
    const r = await pausarAusentesDeCorrida(runId, admin.email);
    revalidatePath("/admin/proveedores");
    revalidatePath("/catalogo");
    revalidatePath("/");
    return {
      success: true,
      pausados: r.pausados.length,
      aRevisar: r.aRevisar.length,
      noVerificados: r.noVerificados.length,
      restantes: r.restantes,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "No se pudo pausar.",
    };
  }
}

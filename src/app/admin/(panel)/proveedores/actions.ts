"use server";

import { ProductOrigin, SyncRunStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import { syncZecatBatch } from "@/lib/zecat/sync";
import {
  acquireSyncRun,
  failSyncRun,
  finishSyncRun,
  recordBatch,
  SyncLockError,
} from "@/lib/sync-run";

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
  /// Solo cuando done: activos nuestros que el proveedor no devolvio.
  missingExternalIds?: string[];
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
      const done = await finishSyncRun(runId);
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
        missingExternalIds: done.missingExternalIds as string[],
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
    throw new Error(`La sincronización falló: ${message}`);
  }
}

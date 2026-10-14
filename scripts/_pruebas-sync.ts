// Helpers para los scripts de verificacion del sync (audit-verify-*). NO es
// codigo de produccion: arman corridas y avance a mano para probar el cierre
// (finishSyncRun) sin pasar por la API del proveedor. El motor real esta en
// src/lib/sync/motor.ts.
import { ProductOrigin } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import type { SyncCounters } from "../src/lib/sync-run";

/// Crea una corrida RUNNING (el indice unico parcial sigue decidiendo: si ya
/// hay una, tira P2002).
export function crearCorrida(provider: ProductOrigin, startedBy: string) {
  return prisma.syncRun.create({ data: { provider, startedBy } });
}

/// Registra avance como lo hace el motor: contadores sumados, vistos
/// agregados, cursor y latido.
export async function registrarAvance(
  runId: string,
  avance: {
    cursor: number;
    totalRemote?: number;
    counters: SyncCounters;
    seenExternalIds: string[];
    errors: Array<{ externalId: string; message: string }>;
  }
) {
  const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
  return prisma.syncRun.update({
    where: { id: runId },
    data: {
      cursor: avance.cursor,
      ...(avance.totalRemote !== undefined ? { totalRemote: avance.totalRemote } : {}),
      created: run.created + avance.counters.created,
      updated: run.updated + avance.counters.updated,
      paused: run.paused + avance.counters.paused,
      failed: run.failed + avance.counters.failed,
      usdWarnings: run.usdWarnings + avance.counters.usdWarnings,
      seenExternalIds: [...(run.seenExternalIds as string[]), ...avance.seenExternalIds],
      errors: [...(run.errors as Array<{ externalId: string; message: string }>), ...avance.errors],
      heartbeatAt: new Date(),
    },
  });
}

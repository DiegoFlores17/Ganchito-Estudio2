import { Prisma, ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/// Lock + progreso de las corridas de sincronización. Agnóstico de
/// proveedor: lo usan el botón del panel Y los scripts de consola, así un
/// `npm run sync:zecat` y un click del cliente no se pisan.

/// RUNNING sin latido por este tiempo = corrida muerta (pestaña cerrada,
/// script matado). Un solo umbral: muerta se RETOMA, viva se respeta.
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

export class SyncLockError extends Error {
  constructor(
    public startedBy: string,
    public startedAt: Date
  ) {
    const min = Math.round((Date.now() - startedAt.getTime()) / 60000);
    super(
      `Ya hay una sincronización corriendo, la inició ${startedBy} hace ${min} min.`
    );
  }
}

export interface SyncCounters {
  created: number;
  updated: number;
  paused: number;
  failed: number;
  usdWarnings: number;
}

/// Toma el lock del proveedor, o retoma una corrida muerta.
///
/// El orden importa y es a propósito:
/// 1. Si hay una RUNNING con latido fresco -> SyncLockError (se respeta).
/// 2. Si hay una RUNNING muerta -> se RETOMA esa misma fila (cursor,
///    contadores e ids vistos incluidos), no se arranca de cero.
/// 3. Si no hay ninguna -> se crea. El índice único parcial de la base
///    (una sola RUNNING por proveedor) es quien decide las carreras: si dos
///    llegan juntos al create, uno recibe P2002 y pierde — nunca
///    consultar-y-crear como única defensa.
export async function acquireSyncRun(
  provider: ProductOrigin,
  startedBy: string
) {
  const running = await prisma.syncRun.findFirst({
    where: { provider, status: SyncRunStatus.RUNNING },
  });

  if (running) {
    const viva =
      Date.now() - running.heartbeatAt.getTime() < HEARTBEAT_STALE_MS;
    if (viva) throw new SyncLockError(running.startedBy, running.startedAt);
    // Muerta: retomarla. El heartbeat se renueva ya mismo para que otro
    // acquire concurrente la vea viva.
    return prisma.syncRun.update({
      where: { id: running.id },
      data: { heartbeatAt: new Date(), startedBy },
    });
  }

  try {
    return await prisma.syncRun.create({
      data: { provider, startedBy },
    });
  } catch (error) {
    // Otro acquire gano la carrera entre nuestro findFirst y el create.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const ganador = await prisma.syncRun.findFirst({
        where: { provider, status: SyncRunStatus.RUNNING },
      });
      throw new SyncLockError(
        ganador?.startedBy ?? "otro proceso",
        ganador?.startedAt ?? new Date()
      );
    }
    throw error;
  }
}

/// Registra el avance de un batch: cursor completado, contadores ACUMULADOS
/// (suma, no reemplaza), ids vistos y errores, y renueva el latido.
export async function recordBatch(
  runId: string,
  batch: {
    cursor: number;
    totalRemote?: number;
    counters: SyncCounters;
    seenExternalIds: string[];
    errors: Array<{ externalId: string; message: string }>;
  }
) {
  const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
  const seen = [
    ...(run.seenExternalIds as string[]),
    ...batch.seenExternalIds,
  ];
  const errors = [
    ...(run.errors as Array<{ externalId: string; message: string }>),
    ...batch.errors,
  ];

  return prisma.syncRun.update({
    where: { id: runId },
    data: {
      cursor: batch.cursor,
      ...(batch.totalRemote !== undefined
        ? { totalRemote: batch.totalRemote }
        : {}),
      created: run.created + batch.counters.created,
      updated: run.updated + batch.counters.updated,
      paused: run.paused + batch.counters.paused,
      failed: run.failed + batch.counters.failed,
      usdWarnings: run.usdWarnings + batch.counters.usdWarnings,
      seenExternalIds: seen,
      errors,
      heartbeatAt: new Date(),
    },
  });
}

/// Cierra la corrida. Al completar calcula los AUSENTES: productos activos
/// del proveedor en NUESTRA base que el proveedor no devolvió en toda la
/// corrida — los candidatos a zombie que en su momento nadie detectó. v1
/// solo los informa; pausarlos automáticamente queda para después.
export async function finishSyncRun(runId: string) {
  const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
  const seen = new Set(run.seenExternalIds as string[]);

  const activos = await prisma.product.findMany({
    where: { origin: run.provider, active: true, deletedAt: null },
    select: { zecatId: true, cdoId: true },
  });
  const externalId = (p: { zecatId: string | null; cdoId: string | null }) =>
    run.provider === ProductOrigin.ZECAT ? p.zecatId : p.cdoId;
  const missing = activos
    .map(externalId)
    .filter((id): id is string => id !== null && !seen.has(id));

  return prisma.syncRun.update({
    where: { id: runId },
    data: {
      status: SyncRunStatus.DONE,
      finishedAt: new Date(),
      missingExternalIds: missing,
    },
  });
}

/// Marca la corrida como fallida (error no recuperable del loop, no de un
/// producto puntual — esos van a `errors` y la corrida sigue).
export async function failSyncRun(runId: string, message: string) {
  const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
  return prisma.syncRun.update({
    where: { id: runId },
    data: {
      status: SyncRunStatus.FAILED,
      finishedAt: new Date(),
      errors: [
        ...(run.errors as Array<{ externalId: string; message: string }>),
        { externalId: "-", message },
      ],
    },
  });
}

import { Prisma, ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendSyncAlert } from "@/lib/email";

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

/// Piso absoluto del umbral de auto-pausado: por debajo de esta cantidad de
/// ausentes se pausa siempre, sin importar el porcentaje (protege catalogos
/// chicos, donde 5% seria 1 o 2 productos). El porcentaje es configurable
/// por proveedor en Supplier.autoPauseMaxPercent.
export const AUTO_PAUSE_FLOOR = 10;

/// Guarda de cordura: si el proveedor devolvio menos de esta fraccion de
/// nuestros activos, la respuesta es anomala (pagina vacia, total_pages
/// mentiroso) y la corrida se marca FAILED sin calcular ausencia siquiera.
const SANITY_MIN_SEEN_RATIO = 0.5;

/// Cierra la corrida: calcula los AUSENTES (activos nuestros que el
/// proveedor no devolvió), auto-pausa los que pasen el umbral, y avisa por
/// mail cuando algo necesita ojo humano.
export async function finishSyncRun(runId: string) {
  const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
  const seen = new Set(run.seenExternalIds as string[]);

  const nuestros = await prisma.product.findMany({
    where: { origin: run.provider, deletedAt: null },
    select: { zecatId: true, cdoId: true, active: true },
  });
  const externalId = (p: { zecatId: string | null; cdoId: string | null }) =>
    run.provider === ProductOrigin.ZECAT ? p.zecatId : p.cdoId;
  const activos = nuestros.filter((p) => p.active).length;

  // Guarda de cordura ANTES de cualquier calculo: una respuesta vacia o a
  // mitad no es informacion sobre ausencias, es un error del proveedor.
  // Sin esta guarda, un estornudo de la API pausaria el catalogo entero.
  if (activos > 0 && seen.size < activos * SANITY_MIN_SEEN_RATIO) {
    const motivo = `Respuesta anómala del proveedor: devolvió ${seen.size} productos contra ${activos} activos nuestros. No se calculó ausencia ni se pausó nada.`;
    const aborted = await failSyncRun(runId, motivo);
    await sendSyncAlert({
      provider: run.provider,
      motivo: "fallo",
      detalle: motivo,
      runId,
    });
    return {
      run: aborted,
      pausedMissingExternalIds: [] as string[],
      aborted: true as const,
    };
  }

  // Dos conjuntos, porque juntos confunden: `missing` son ACTIVOS que el
  // proveedor ya no devuelve (accionables); `pausedMissing` son los YA
  // pausados que siguen fuera de la API (informativos — sin ellos, "3
  // ausentes" y "17 fuera de la API" parecen contradecirse).
  const missing: string[] = [];
  const pausedMissing: string[] = [];
  for (const p of nuestros) {
    const id = externalId(p);
    if (id === null || seen.has(id)) continue;
    (p.active ? missing : pausedMissing).push(id);
  }

  // Auto-pausado con umbral: un producto que el proveedor no ofrece no se
  // puede vender, y pausar es reversible (si vuelve a la API, el proximo
  // sync lo reactiva via `published`). Pero una caida MASIVA de golpe es
  // casi seguro un error del proveedor: por encima de max(FLOOR, X% de los
  // activos) no se pausa NINGUNO y se deja la decision al humano. La
  // asimetria justifica el umbral generoso: pausar de mas se revierte solo;
  // frenar de mas deja productos fantasma a la venta.
  const supplier = await prisma.supplier.upsert({
    where: { origin: run.provider },
    update: {},
    create: {
      origin: run.provider,
      name: run.provider === ProductOrigin.ZECAT ? "Zecat" : run.provider,
    },
  });
  const umbral = Math.max(
    AUTO_PAUSE_FLOOR,
    Math.floor((activos * Number(supplier.autoPauseMaxPercent)) / 100)
  );

  let autoPaused: string[] = [];
  let autoPauseSkipped = false;
  if (missing.length > 0 && missing.length <= umbral) {
    const idField =
      run.provider === ProductOrigin.ZECAT ? "zecatId" : "cdoId";
    await prisma.product.updateMany({
      where: {
        origin: run.provider,
        [idField]: { in: missing },
        active: true,
      },
      data: { active: false },
    });
    autoPaused = missing;
  } else if (missing.length > umbral) {
    autoPauseSkipped = true;
    // ESTE mail es lo que hace posible el cron: con corridas desatendidas,
    // un umbral frenado no lo ve nadie hasta que alguien entra al panel de
    // casualidad. Nunca tira (ver lib/email.ts).
    await sendSyncAlert({
      provider: run.provider,
      motivo: "umbral",
      detalle:
        `${missing.length} productos activos dejaron de venir en la API de golpe, y el umbral de seguridad es ${umbral}. ` +
        `NO se pausó ninguno: puede ser un problema del proveedor y no ${missing.length} discontinuaciones reales. ` +
        `Ids: ${missing.slice(0, 30).join(", ")}${missing.length > 30 ? "…" : ""}`,
      runId: runId,
    });
  }

  const updated = await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status: SyncRunStatus.DONE,
      finishedAt: new Date(),
      missingExternalIds: missing,
      autoPausedExternalIds: autoPaused,
      autoPauseSkipped,
    },
  });
  // pausedMissing no se persiste (es derivable del estado actual); se
  // devuelve para el resumen inmediato.
  return {
    run: updated,
    pausedMissingExternalIds: pausedMissing,
    aborted: false as const,
  };
}

/// Marca FAILED. NO manda alerta por si sola: quien la llama decide, porque
/// finishSyncRun la usa para el aborto por cordura y ahi el mail lo manda
/// con su propio detalle (si alertara aca tambien, saldrian dos).
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

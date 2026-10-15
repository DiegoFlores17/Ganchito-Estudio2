import { Prisma, ProductOrigin } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { alertConfigStatus, sendSyncAlert, type EnvioResultado } from "@/lib/email";
import {
  describirAusentes,
  estadoDelProveedor,
  leerSummary,
  type EstadoProveedor,
} from "@/lib/sync-run";

/// Alertas por CAMBIO DE ESTADO, no por corrida. Con el cron corriendo dos
/// veces por dia, un umbral frenado mandaria un mail por corrida mientras
/// nadie lo resuelva — y el primero ya se perdio una vez en un hilo de
/// Gmail. Las reglas:
/// - Entrar en un problema (FALLANDO, BLOQUEADO, A_REVISAR, DESACTUALIZADO):
///   un mail.
/// - Seguir en el mismo problema: nada, salvo un recordatorio cada 72 h.
///   Una racha de fallos es UN mail.
/// - Un bloqueo que cambia de forma (aparecen ausentes que no estaban): un
///   mail nuevo.
/// - Volver a OK despues de un problema avisado: un mail de "resuelto".
///
/// Lo avisado queda registrado en la corrida sobre la que se aviso
/// (SyncRun.alertedAt + una nota "Alerta: <ESTADO>" en errors): asi el
/// estado anunciado se lee del historial y se ve en el panel.
///
/// Concurrencia: decidir y reclamar el aviso ocurre bajo un lock por
/// proveedor (pg_advisory_xact_lock). Si dos ticks llegan juntos (el que
/// cerro la corrida y uno "ocupado" del cron), el segundo espera, ve lo que
/// anuncio el primero y no repite. El mail sale DESPUES del commit; si
/// falla, el reclamo se devuelve y el tick siguiente reintenta.

export const RECORDATORIO_MS = 72 * 60 * 60 * 1000;
const PREFIJO_NOTA = "Alerta: ";

type Anunciado = { runId: string; estado: EstadoProveedor; alertedAt: Date } | null;
type Nota = { externalId: string; message: string };

type Decision =
  | { tipo: "nada"; estado: EstadoProveedor }
  | {
      tipo: "enviar";
      estado: EstadoProveedor;
      /// Estado anunciado antes (para el texto de "resuelto").
      antes: EstadoProveedor | null;
      runId: string;
      recordatorio: boolean;
      alertedAtAnterior: Date | null;
      est: Awaited<ReturnType<typeof estadoDelProveedor>>;
    };

/// Mira el estado del proveedor y manda el mail que corresponda (o ninguno).
/// Se llama despues de cada tick del cron, al terminar una corrida del panel
/// o la consola, y desde el cron del dolar (el vigilante de frescura: si el
/// cron del sync dejo de disparar, este sigue). Devuelve que hizo.
export async function revisarAlertas(
  provider: ProductOrigin,
  ahora: Date = new Date()
): Promise<{ accion: "nada" | "aviso" | "recordatorio" | "resuelto"; estado: EstadoProveedor }> {
  // Sin alertas configuradas no se intenta nada: reintentar en cada tick
  // solo llenaria el log, y el panel ya muestra en rojo que faltan.
  const config = alertConfigStatus();
  if (config.destinatarios.length === 0 || !config.tieneApiKey) {
    return { accion: "nada", estado: (await estadoDelProveedor(provider, ahora)).estado };
  }

  const decision = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`alertas:${provider}`}))`;
      const d = await decidir(provider, ahora);
      if (d.tipo === "enviar") await reclamar(tx, d, ahora);
      return d;
    },
    { timeout: 20_000 }
  );
  if (decision.tipo === "nada") return { accion: "nada", estado: decision.estado };

  const r = await enviar(provider, decision);
  if (!r.ok) {
    await devolverReclamo(provider, decision, ahora);
    return { accion: "nada", estado: decision.estado };
  }
  return {
    accion: decision.estado === "OK" ? "resuelto" : decision.recordatorio ? "recordatorio" : "aviso",
    estado: decision.estado,
  };
}

async function decidir(provider: ProductOrigin, ahora: Date): Promise<Decision> {
  const est = await estadoDelProveedor(provider, ahora);
  const anuncio = await ultimoAnuncio(provider);
  const habiaProblema = anuncio !== null && anuncio.estado !== "OK";

  if (est.estado === "OK") {
    if (!habiaProblema || !est.ultimaCompleta) return { tipo: "nada", estado: est.estado };
    return armar(est, est.ultimaCompleta.id, anuncio!.estado, false);
  }

  // La corrida sobre la que se avisa: la fallida si esta fallando; si no, la
  // ultima completa (bloqueo, a revisar, o la que quedo vieja). Sin ninguna
  // corrida no hay donde registrar el aviso (limite conocido: un proveedor
  // que nunca corrio no avisa "desactualizado").
  const objetivo = est.estado === "FALLANDO" ? est.ultimaFallida?.id : est.ultimaCompleta?.id;
  if (!objetivo) return { tipo: "nada", estado: est.estado };

  let recordatorio = false;
  if (habiaProblema && anuncio!.estado === est.estado) {
    const cambioDeForma =
      est.estado === "BLOQUEADO" && objetivo !== anuncio!.runId
        ? await hayAusentesNuevos(anuncio!.runId, est.pendientes)
        : false;
    if (!cambioDeForma) {
      if (ahora.getTime() - anuncio!.alertedAt.getTime() < RECORDATORIO_MS) {
        return { tipo: "nada", estado: est.estado };
      }
      recordatorio = true;
    }
  }
  return armar(est, objetivo, anuncio?.estado ?? null, recordatorio);

  async function armar(
    e: typeof est,
    runId: string,
    antes: EstadoProveedor | null,
    rec: boolean
  ): Promise<Decision> {
    const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId }, select: { alertedAt: true } });
    return {
      tipo: "enviar",
      estado: e.estado,
      antes,
      runId,
      recordatorio: rec,
      alertedAtAnterior: run.alertedAt,
      est: e,
    };
  }
}

/// Lo ultimo que se aviso por mail para este proveedor.
async function ultimoAnuncio(provider: ProductOrigin): Promise<Anunciado> {
  const run = await prisma.syncRun.findFirst({
    where: { provider, alertedAt: { not: null } },
    orderBy: { alertedAt: "desc" },
    select: { id: true, alertedAt: true, errors: true },
  });
  if (!run?.alertedAt) return null;
  const nota = [...(run.errors as Nota[])].reverse().find((e) => e.externalId === "alerta");
  const estado = nota?.message.slice(PREFIJO_NOTA.length).split(" ")[0] as EstadoProveedor | undefined;
  return estado ? { runId: run.id, estado, alertedAt: run.alertedAt } : null;
}

/// Reclama el aviso: alertedAt y la nota con el tipo, en el mismo paso y
/// dentro del lock. Desde aca, cualquier otro que decida ya lo ve anunciado.
async function reclamar(tx: Prisma.TransactionClient, d: Extract<Decision, { tipo: "enviar" }>, ahora: Date) {
  const run = await tx.syncRun.findUniqueOrThrow({ where: { id: d.runId }, select: { errors: true } });
  await tx.syncRun.update({
    where: { id: d.runId },
    data: {
      alertedAt: ahora,
      errors: [
        ...(run.errors as Prisma.JsonArray),
        {
          externalId: "alerta",
          message: `${PREFIJO_NOTA}${d.estado}${d.recordatorio ? " (recordatorio)" : ""} enviada el ${ahora.toISOString()}.`,
        },
      ],
    },
  });
}

/// El mail no salio: se saca la nota y se restaura alertedAt, asi el tick
/// siguiente vuelve a intentarlo.
async function devolverReclamo(
  provider: ProductOrigin,
  d: Extract<Decision, { tipo: "enviar" }>,
  ahora: Date
) {
  await prisma.$transaction(async (tx) => {
    // El mismo lock que decidir/reclamar: nadie decide sobre un reclamo a
    // medio devolver.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`alertas:${provider}`}))`;
    const run = await tx.syncRun.findUnique({ where: { id: d.runId }, select: { errors: true, alertedAt: true } });
    if (!run || run.alertedAt?.getTime() !== ahora.getTime()) return;
    const errores = [...(run.errors as Nota[])];
    const i = errores.map((e) => e.externalId).lastIndexOf("alerta");
    if (i >= 0) errores.splice(i, 1);
    await tx.syncRun.update({
      where: { id: d.runId },
      data: { alertedAt: d.alertedAtAnterior, errors: errores },
    });
  });
}

/// true si el bloqueo actual tiene ausentes que el bloqueo avisado no tenia.
async function hayAusentesNuevos(runAvisada: string, pendientes: string[]) {
  const run = await prisma.syncRun.findUnique({ where: { id: runAvisada } });
  // Si la corrida avisada ya no existe, no hay con que comparar: se avisa.
  if (!run) return true;
  const antes = new Set(leerSummary(run)?.ausentes ?? (run.missingExternalIds as string[]));
  return pendientes.some((id) => !antes.has(id));
}

async function enviar(
  provider: ProductOrigin,
  d: Extract<Decision, { tipo: "enviar" }>
): Promise<EnvioResultado> {
  const { est, runId, recordatorio } = d;
  switch (d.estado) {
    case "OK":
      return sendSyncAlert({ motivo: "resuelto", provider, runId, antes: etiqueta(d.antes ?? "OK") });
    case "FALLANDO": {
      const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
      const errores = (run.errors as Nota[]).filter((e) => e.externalId === "-");
      return sendSyncAlert({
        motivo: "fallo",
        provider,
        runId,
        recordatorio,
        detalle: `La sincronización se cortó con: ${errores.at(-1)?.message ?? "error desconocido"}`,
      });
    }
    case "BLOQUEADO": {
      const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
      const s = leerSummary(run);
      return sendSyncAlert({
        motivo: "umbral",
        provider,
        runId,
        recordatorio,
        umbral: s?.umbral ?? 0,
        activos: s?.activos ?? 0,
        ausentes: await describirAusentes(provider, est.pendientes),
      });
    }
    case "A_REVISAR": {
      const descriptos = await describirAusentes(
        provider,
        est.sinVerificar.map((x) => x.externalId)
      );
      return sendSyncAlert({
        motivo: "a-revisar",
        provider,
        runId,
        recordatorio,
        productos: await describirAusentes(provider, est.aRevisar),
        sinVerificar: est.sinVerificar.map((x, i) => ({
          ...descriptos[i],
          permanente: x.permanente,
          motivoVerificacion: x.motivo,
        })),
      });
    }
    case "DESACTUALIZADO": {
      const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
      return sendSyncAlert({
        motivo: "desactualizado",
        provider,
        runId,
        recordatorio,
        ultimaCompleta: run.finishedAt ?? run.startedAt,
      });
    }
  }
}

function etiqueta(estado: EstadoProveedor): string {
  return {
    OK: "al día",
    FALLANDO: "la sincronización fallaba",
    BLOQUEADO: "pausado frenado por el umbral",
    A_REVISAR: "productos a revisar",
    DESACTUALIZADO: "catálogo desactualizado",
  }[estado];
}

/// Vigilante de frescura desde afuera del cron del sync (lo llama el cron
/// del dolar): si el sync automatico esta activado y dejo de completar,
/// alguien se entera aunque el propio cron del sync no este disparando.
/// Con el interruptor apagado no avisa nada: sincronizar es manual y el
/// catalogo viejo es una decision, no una falla.
export async function vigilarFrescura(provider: ProductOrigin, ahora: Date = new Date()) {
  const supplier = await prisma.supplier.findUnique({ where: { origin: provider } });
  if (!supplier?.autoSyncEnabled) return { accion: "nada" as const, motivo: "sync automático apagado" };
  return revisarAlertas(provider, ahora);
}

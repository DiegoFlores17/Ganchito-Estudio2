import { Prisma, ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendSyncAlert, type AusenteAlerta } from "@/lib/email";
import { MOTIVO_FUERA_DE_TOPE } from "@/lib/sync/textos";
import { conectorDe } from "@/lib/sync/conectores";

/// Lock + progreso + historial de las corridas de sincronizacion. El lock
/// ahora es el LEASE de cada corrida (lib/sync/motor.ts): lo toman el cron,
/// el boton del panel y la consola por igual.

/// Contadores de una corrida (los acumula el motor producto por producto).
export interface SyncCounters {
  created: number;
  updated: number;
  paused: number;
  failed: number;
  usdWarnings: number;
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

/// Resumen de una corrida TAL COMO QUEDO al terminar. Se escribe una sola
/// vez en finishSyncRun (SyncRun.summary) y el panel lo lee tal cual: la
/// card del resultado y la fila del historial muestran la misma fuente, y
/// una corrida vieja no "cambia" cuando despues cambia el catalogo.
export interface SyncRunSummary {
  version: 1;
  creados: number;
  actualizados: number;
  fallidos: number;
  /// Pausados por falta de precio del proveedor (ZecatPricingError).
  pausadosSinPrecio: number;
  monedaSospechosa: number;
  totalRemoto: number | null;
  vistos: number;
  /// Activos nuestros al cerrar, y el umbral que se aplico con ellos.
  activos: number;
  umbral: number;
  /// Activos que el proveedor no devolvio en esta corrida.
  ausentes: string[];
  /// true si eran mas que el umbral y no se pauso ninguno.
  umbralFrenado: boolean;
  /// Ausentes que el detalle confirmo como baja y se pausaron al cerrar.
  autoPausados: string[];
  /// Ausentes con el detalle sano (publicado y con variantes): NO se
  /// pausan, se muestran como "a revisar".
  aRevisar: string[];
  /// Ausentes que no se pudieron verificar contra el detalle: NO se pausan.
  noVerificados: string[];
  /// Por que no se pudo verificar cada uno de `noVerificados`. Opcional: las
  /// corridas anteriores al campo no lo tienen, y ahi todos cuentan como
  /// transitorios.
  /// - permanente: la verificacion no puede salir nunca (un producto de CDO
  ///   sin code guardado); `motivo` es la frase corta para el admin. Pasa a
  ///   "a revisar" desde la primera corrida.
  /// - transitorio: timeout, 5xx, red, o fuera del tope de confirmaciones;
  ///   la proxima corrida lo reintenta. Pasa a "a revisar" a las 3 corridas
  ///   completas seguidas (ver sinVerificarPendientes).
  noVerificadosDetalle?: Record<string, { permanente: boolean; motivo: string }>;
  /// Ya pausados que seguian fuera de la API en este momento.
  yaPausadosFueraDeApi: string[];
  variantesDesactivadas: number;
  productosSinVariantes: number;
  /// Activos que esta corrida apago por quedarse sin foto usable, y los
  /// que conservaron su estado porque la corrida ya habia llegado al umbral
  /// (ver el tope en lib/sync/motor.ts). Opcionales: las corridas anteriores
  /// al campo no los tienen.
  apagadosSinFoto?: string[];
  retenidosSinFoto?: string[];
  /// true si esta corrida LLEGO al tope de "sin foto": se habrian apagado
  /// mas que el umbral. Mientras la ultima corrida completa lo tenga, la
  /// siguiente no apaga ninguno por foto (racha: ver rachaSinFotoActiva).
  topeSinFoto?: boolean;
  /// true si esta corrida arranco con la racha activa (no apago ninguno).
  rachaSinFoto?: boolean;
  /// Nombre de cada id de las listas de arriba, para mostrar algo legible
  /// sin consultar el estado actual (que puede haber cambiado).
  nombres: Record<string, string>;
}

/// Pregunta al proveedor por cada ausente antes de pausarlo, via su
/// conector (lib/sync/conectores.ts). Un proveedor sin conector no confirma
/// nada (todo queda "no-verificado"): nunca se pausa a ciegas.

/// De a cuantos se confirman en paralelo.
const CONFIRMACIONES_EN_PARALELO = 8;

/// Tope de confirmaciones por llamada. Con 15 s de timeout por pedido y de a
/// 8, 40 ids son 5 tandas: ~75 s en el peor caso (Zecat colgado), dentro de
/// los 120 s de la invocacion del panel junto con el ultimo batch. Lo que
/// queda afuera no se pausa: en el cierre queda "no verificado" (la proxima
/// corrida lo reintenta); en el boton queda pendiente (se vuelve a tocar).
export const MAX_CONFIRMACIONES_POR_LLAMADA = 40;

/// Confirma cada ausente contra el proveedor y pausa las bajas confirmadas
/// TANDA POR TANDA, registrandolas en la corrida en el mismo paso. Si la
/// invocacion muere a mitad de camino, lo ya pausado queda registrado: no
/// hay productos pausados sin rastro de quien los pauso.
export async function confirmarYPausar(
  provider: ProductOrigin,
  externalIds: string[],
  runId: string,
  max = MAX_CONFIRMACIONES_POR_LLAMADA
): Promise<{
  bajas: string[];
  aRevisar: string[];
  noVerificados: string[];
  sinIntentar: string[];
  detalle: Record<string, { permanente: boolean; motivo: string }>;
}> {
  const confirmar = conectorDe(provider)?.confirmarAusente;
  const bajas: string[] = [];
  const aRevisar: string[] = [];
  const noVerificados: string[] = [];
  const detalle: Record<string, { permanente: boolean; motivo: string }> = {};
  if (!confirmar) {
    return { bajas, aRevisar, noVerificados: [...externalIds], sinIntentar: [], detalle };
  }
  const aIntentar = externalIds.slice(0, max);
  const sinIntentar = externalIds.slice(max);

  for (let i = 0; i < aIntentar.length; i += CONFIRMACIONES_EN_PARALELO) {
    const tanda = aIntentar.slice(i, i + CONFIRMACIONES_EN_PARALELO);
    const resultados = await Promise.all(tanda.map((id) => confirmar(id)));
    const bajasTanda: string[] = [];
    tanda.forEach((id, j) => {
      const { resultado, motivo, causaPermanente } = resultados[j];
      if (resultado === "baja") bajasTanda.push(id);
      else if (resultado === "presente") aRevisar.push(id);
      else {
        noVerificados.push(id);
        detalle[id] = causaPermanente
          ? { permanente: true, motivo: causaPermanente }
          : { permanente: false, motivo };
      }
      if (resultado !== "baja") {
        console.warn(`[sync-run] Ausente ${id} NO se pausa (${resultado}): ${motivo}`);
      }
    });
    if (bajasTanda.length) {
      await pausar(provider, bajasTanda);
      await registrarPausados(runId, bajasTanda);
      bajas.push(...bajasTanda);
    }
  }
  for (const id of sinIntentar) {
    detalle[id] = { permanente: false, motivo: MOTIVO_FUERA_DE_TOPE };
  }
  return { bajas, aRevisar, noVerificados, sinIntentar, detalle };
}

/// Suma ids a autoPausedExternalIds de una corrida (y opcionalmente una
/// nota a errors) con la fila BLOQUEADA: dos admins apretando "Pausar estos
/// N" a la vez no se pisan los registros — el segundo lee lo que escribio el
/// primero, no una copia vieja.
async function registrarPausados(
  runId: string,
  ids: string[],
  nota?: { externalId: string; message: string }
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sync_runs WHERE id = ${runId} FOR UPDATE`;
    const actual = await tx.syncRun.findUniqueOrThrow({
      where: { id: runId },
      select: { autoPausedExternalIds: true, errors: true },
    });
    const ya = actual.autoPausedExternalIds as string[];
    await tx.syncRun.update({
      where: { id: runId },
      data: {
        autoPausedExternalIds: [...ya, ...ids.filter((id) => !ya.includes(id))],
        ...(nota
          ? {
              errors: [
                ...(actual.errors as Array<{ externalId: string; message: string }>),
                nota,
              ],
            }
          : {}),
      },
    });
  });
}

function idField(provider: ProductOrigin) {
  return provider === ProductOrigin.ZECAT ? "zecatId" : "cdoId";
}

/// Pausa productos por id externo, solo los que siguen activos.
async function pausar(provider: ProductOrigin, externalIds: string[]) {
  if (externalIds.length === 0) return;
  await prisma.product.updateMany({
    where: {
      origin: provider,
      [idField(provider)]: { in: externalIds },
      active: true,
    },
    data: { active: false },
  });
}

async function nombresDe(provider: ProductOrigin, externalIds: string[]) {
  if (externalIds.length === 0) return {};
  const productos = await prisma.product.findMany({
    where: { origin: provider, [idField(provider)]: { in: externalIds } },
    select: { zecatId: true, cdoId: true, name: true },
  });
  return Object.fromEntries(
    productos.map((p) => [
      (provider === ProductOrigin.ZECAT ? p.zecatId : p.cdoId) ?? "?",
      p.name.trim(),
    ])
  );
}

/// Cierra la corrida: calcula los AUSENTES (activos nuestros que el
/// proveedor no devolvió), confirma cada uno contra el detalle y pausa solo
/// las bajas confirmadas (si no superan el umbral), escribe el resumen fijo
/// y avisa por mail cuando algo necesita ojo humano.
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
    // El mail lo manda la maquina de estados (lib/sync/alertas.ts) al ver
    // la corrida FAILED: asi una racha de fallos es UN mail, no uno por vez.
    const aborted = await failSyncRun(runId, motivo);
    return { run: aborted, summary: null, aborted: true as const };
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
      name: { ZECAT: "Zecat", CDO: "CDO Promocionales" }[run.provider as string] ?? run.provider,
    },
  });
  const umbral = Math.max(
    AUTO_PAUSE_FLOOR,
    Math.floor((activos * Number(supplier.autoPauseMaxPercent)) / 100)
  );

  // Por debajo del umbral, cada ausente se CONFIRMA contra el detalle antes
  // de pausarlo: faltar del listado no alcanza (un error de recorrido, o un
  // producto que Zecat saca del listado pero sigue publicado). Solo se pausa
  // lo que el proveedor confirma como baja.
  let confirmacion = {
    bajas: [] as string[],
    aRevisar: [] as string[],
    noVerificados: [] as string[],
    sinIntentar: [] as string[],
    detalle: {} as Record<string, { permanente: boolean; motivo: string }>,
  };
  const umbralFrenado = missing.length > umbral;
  if (missing.length > 0 && !umbralFrenado) {
    confirmacion = await confirmarYPausar(run.provider, missing, runId);
  }
  // Umbral frenado: el mail lo manda la maquina de estados (BLOQUEADO), que
  // no lo repite en cada corrida mientras el bloqueo sea el mismo. La
  // confirmacion de cada ausente la hace el boton "Pausar estos N".

  // Un conteo y una alerta: si fallan, la corrida igual se marca DONE (el
  // auto-pausado de arriba ya se aplico; quedar RUNNING por esto seria peor).
  // Sin repetidos: si una invocacion murio entre el commit de un producto y
  // el registro de su avance, ese producto se reproceso y pudo anotarse dos
  // veces. Vale la ULTIMA anotacion de cada id.
  const ultimaPorId = new Map(
    (run.sinFotoExternalIds as Array<{ id: string; retenido: boolean }>).map((x) => [x.id, x.retenido])
  );
  const apagadosSinFoto = [...ultimaPorId].filter(([, retenido]) => !retenido).map(([id]) => id);
  const retenidosSinFoto = [...ultimaPorId].filter(([, retenido]) => retenido).map(([id]) => id);
  // Llego al tope? Sin racha, el motor apaga hasta el umbral y retiene el
  // resto: hay retenidos solo si se paso. Con racha no se apaga ninguno y
  // todos quedan retenidos: se paso si los que se habrian apagado superan
  // el umbral. Por debajo, la racha se corta y la proxima corrida aplica.
  const rachaSinFoto = await rachaSinFotoActiva(run.provider, runId);
  const topeSinFoto = rachaSinFoto ? retenidosSinFoto.length > umbral : retenidosSinFoto.length > 0;
  if (topeSinFoto) {
    // Mismo criterio que las variantes: una alerta por corrida, y si falla
    // la corrida igual se cierra.
    try {
      await sendSyncAlert({
        provider: run.provider,
        motivo: "sin-foto",
        runId,
        racha: rachaSinFoto,
        // El limite que se APLICO: el motor lo calcula por tick con los
        // activos de ese momento, y al cerrar ya hay menos activos (justamente
        // los apagados), asi que `umbral` de aca puede dar uno o dos menos.
        // Con retenidos, el tope se alcanzo: lo aplicado son los apagados.
        umbral: rachaSinFoto ? umbral : apagadosSinFoto.length,
        apagados: await describirAusentes(run.provider, apagadosSinFoto),
        retenidos: await describirAusentes(run.provider, retenidosSinFoto),
      });
    } catch (error) {
      console.error("[sync-run] No se pudo mandar la alerta de productos sin foto:", error);
    }
  }

  let variantes: Awaited<ReturnType<typeof revisarVariantes>>;
  try {
    variantes = await revisarVariantes(run, umbral, supplier);
  } catch (error) {
    console.error("[sync-run] No se pudo revisar las variantes de la corrida:", error);
    variantes = { desactivadas: 0, productosSinVariantes: [] };
  }

  const summary: SyncRunSummary = {
    version: 1,
    creados: run.created,
    actualizados: run.updated,
    fallidos: run.failed,
    pausadosSinPrecio: run.paused,
    monedaSospechosa: run.usdWarnings,
    totalRemoto: run.totalRemote,
    vistos: seen.size,
    activos,
    umbral,
    ausentes: missing,
    umbralFrenado,
    // Lo registrado en la corrida (incluye lo de un intento anterior de
    // cierre que haya muerto despues de pausar), no solo lo de esta llamada.
    autoPausados: (
      await prisma.syncRun.findUniqueOrThrow({
        where: { id: runId },
        select: { autoPausedExternalIds: true },
      })
    ).autoPausedExternalIds as string[],
    aRevisar: confirmacion.aRevisar,
    // Los que quedaron afuera del tope tampoco se verificaron.
    noVerificados: [...confirmacion.noVerificados, ...confirmacion.sinIntentar],
    noVerificadosDetalle: confirmacion.detalle,
    yaPausadosFueraDeApi: pausedMissing,
    variantesDesactivadas: variantes.desactivadas,
    productosSinVariantes: variantes.productosSinVariantes.length,
    apagadosSinFoto,
    retenidosSinFoto,
    topeSinFoto,
    rachaSinFoto,
    nombres: await nombresDe(run.provider, [
      ...missing,
      ...pausedMissing,
      ...apagadosSinFoto,
      ...retenidosSinFoto,
    ]).catch(
      (error) => {
        // Cosmetico: sin nombres el panel muestra los ids. No rompe el cierre.
        console.error("[sync-run] No se pudieron leer los nombres para el resumen:", error);
        return {} as Record<string, string>;
      }
    ),
  };

  const updated = await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status: SyncRunStatus.DONE,
      finishedAt: new Date(),
      missingExternalIds: missing,
      // autoPausedExternalIds ya se fue registrando tanda por tanda.
      autoPauseSkipped: umbralFrenado,
      summary: summary as unknown as Prisma.InputJsonValue,
    },
  });
  return { run: updated, summary, aborted: false as const };
}

/// true si la ULTIMA corrida completa del proveedor (sin contar `excluir`,
/// la que esta en curso) llego al tope de "sin foto".
///
/// El tope es por RACHA, no por corrida: con un tope por corrida, una caida
/// 403 de la CDN que dure dias apagaria el umbral en CADA corrida (dos por
/// dia). Con la racha, apaga como maximo el umbral en total: mientras la
/// ultima completa haya llegado al tope, no se apaga ninguno por foto, hasta
/// que una corrida complete por debajo. Las corridas FAILED no cuentan.
export async function rachaSinFotoActiva(provider: ProductOrigin, excluir: string): Promise<boolean> {
  const anterior = await prisma.syncRun.findFirst({
    where: { provider, status: SyncRunStatus.DONE, id: { not: excluir } },
    orderBy: { finishedAt: "desc" },
    select: { summary: true },
  });
  return anterior ? leerSummary(anterior)?.topeSinFoto === true : false;
}

/// Lee el resumen de una corrida. Null en las anteriores al campo: el panel
/// muestra "no registrado" en vez de recalcular desde el estado actual.
export function leerSummary(run: { summary: Prisma.JsonValue }): SyncRunSummary | null {
  const s = run.summary as SyncRunSummary | null;
  return s && s.version === 1 ? s : null;
}

/// "Pausar estos N": para una corrida con el umbral frenado, pausa los
/// ausentes que el proveedor CONFIRMA como baja en este momento.
///
/// Solo sobre la ULTIMA corrida completa del proveedor: una mas vieja
/// describe un catalogo que ya cambio. Lo pausado se suma a
/// autoPausedExternalIds de esa corrida (mismo registro que el auto-pausado,
/// y se reactiva solo si vuelve a la API). El resumen fijo NO se toca: es lo
/// que paso al cerrar; lo de despues se lee de autoPausedExternalIds y de
/// la nota en errors.
export async function pausarAusentesDeCorrida(runId: string, adminEmail: string) {
  const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
  const ultima = await prisma.syncRun.findFirst({
    where: { provider: run.provider, status: SyncRunStatus.DONE, finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" },
    select: { id: true },
  });
  if (ultima?.id !== run.id) {
    throw new Error("Solo se puede pausar desde la última corrida completa del proveedor.");
  }
  if (!run.autoPauseSkipped) {
    throw new Error("Esta corrida no tiene ausentes frenados por el umbral.");
  }

  const pendientes = await ausentesPendientes(run);
  // Confirma y pausa por tanda, registrando en la corrida a medida que
  // avanza. Con mas de MAX_CONFIRMACIONES_POR_LLAMADA pendientes, el resto
  // queda para el proximo click (el boton vuelve a mostrar cuantos quedan).
  const { bajas, aRevisar, noVerificados, sinIntentar } = await confirmarYPausar(
    run.provider,
    pendientes,
    run.id
  );
  await registrarPausados(run.id, [], {
    externalId: "-",
    message:
      `Pausar estos ${pendientes.length}: ${adminEmail} el ${new Date().toISOString()}. ` +
      `${bajas.length} pausados (baja confirmada), ${aRevisar.length} siguen publicados (a revisar), ` +
      `${noVerificados.length} no se pudieron verificar` +
      (sinIntentar.length ? `, ${sinIntentar.length} quedan para otro click.` : "."),
  });

  return { pausados: bajas, aRevisar, noVerificados, restantes: sinIntentar.length };
}

/// Ausentes de una corrida frenada que todavia no se resolvieron: no
/// pausados por la corrida (ni despues por el boton) y aun ACTIVOS. Si
/// alguien los pauso por otro camino, ya no cuentan.
export async function ausentesPendientes(run: {
  provider: ProductOrigin;
  summary: Prisma.JsonValue;
  missingExternalIds: Prisma.JsonValue;
  autoPausedExternalIds: Prisma.JsonValue;
}): Promise<string[]> {
  const ausentes = leerSummary(run)?.ausentes ?? (run.missingExternalIds as string[]);
  const pausados = new Set(run.autoPausedExternalIds as string[]);
  const candidatos = ausentes.filter((id) => !pausados.has(id));
  if (candidatos.length === 0) return [];
  const activos = await prisma.product.findMany({
    where: {
      origin: run.provider,
      deletedAt: null,
      active: true,
      [idField(run.provider)]: { in: candidatos },
    },
    select: { zecatId: true, cdoId: true },
  });
  const activosSet = new Set(
    activos.map((p) => (run.provider === ProductOrigin.ZECAT ? p.zecatId : p.cdoId))
  );
  return candidatos.filter((id) => activosSet.has(id));
}

/// Sin una corrida COMPLETA en este tiempo, el catalogo se considera viejo.
/// 26 h y no 24: con dos corridas por dia, perder una sola no alcanza para
/// alarmar; perder las dos de un dia, si.
export const DESACTUALIZADO_MS = 26 * 60 * 60 * 1000;

export type EstadoProveedor =
  | "OK"
  | "BLOQUEADO"
  | "FALLANDO"
  | "DESACTUALIZADO"
  | "A_REVISAR";

/// Estado del catalogo de un proveedor, calculado del historial. Prioridad:
/// FALLANDO (la ultima corrida fallo y no hay una completa despues) >
/// BLOQUEADO (la ultima completa freno el umbral y quedan ausentes sin
/// resolver) > DESACTUALIZADO (ninguna completa en 26 h) > A_REVISAR (la
/// ultima completa dejo productos que el proveedor publica pero no lista, y
/// siguen a la venta) > OK.
///
/// A_REVISAR no puede ser verde: esos productos siguen en la tienda y ya no
/// se sincronizan (no vienen en el listado), asi que su precio y stock
/// envejecen sin que nada lo muestre. Se resuelve solo si vuelven al
/// listado (la corrida siguiente ya no los tiene a revisar) o si se pausan.
export async function estadoDelProveedor(provider: ProductOrigin, ahora = new Date()) {
  const [ultimaCompleta, ultima] = await Promise.all([
    prisma.syncRun.findFirst({
      // finishedAt not null: Postgres ordena los NULL primero en "desc".
      where: { provider, status: SyncRunStatus.DONE, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.syncRun.findFirst({
      where: { provider, status: { not: SyncRunStatus.RUNNING } },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const fallando =
    ultima?.status === SyncRunStatus.FAILED &&
    (!ultimaCompleta || ultima.startedAt > ultimaCompleta.startedAt);
  const pendientes =
    ultimaCompleta?.autoPauseSkipped ? await ausentesPendientes(ultimaCompleta) : [];
  const aRevisar = ultimaCompleta ? await aRevisarPendientes(ultimaCompleta) : [];
  const sinVerificar = ultimaCompleta ? await sinVerificarPendientes(ultimaCompleta) : [];
  const desactualizado =
    !ultimaCompleta?.finishedAt ||
    ahora.getTime() - ultimaCompleta.finishedAt.getTime() > DESACTUALIZADO_MS;

  const estado: EstadoProveedor = fallando
    ? "FALLANDO"
    : pendientes.length > 0
      ? "BLOQUEADO"
      : desactualizado
        ? "DESACTUALIZADO"
        : aRevisar.length > 0 || sinVerificar.length > 0
          ? "A_REVISAR"
          : "OK";

  return {
    estado,
    ultimaCompleta: ultimaCompleta
      ? {
          id: ultimaCompleta.id,
          finishedAt: ultimaCompleta.finishedAt!,
          startedBy: ultimaCompleta.startedBy,
        }
      : null,
    ultimaFallida: fallando && ultima ? { id: ultima.id, startedAt: ultima.startedAt } : null,
    pendientes,
    /// Los "a revisar" de la ultima completa que siguen activos.
    aRevisar,
    /// Ausentes que no se pueden verificar y ya no conviene esperar (ver
    /// sinVerificarPendientes). Tambien ponen el estado en A_REVISAR.
    sinVerificar,
  };
}

/// Corridas completas SEGUIDAS sin poder verificar un ausente (por un motivo
/// transitorio) antes de pasarlo a "a revisar". Con dos corridas por dia,
/// ~1,5 dias: lo bastante para que una caida del proveedor se resuelva sola.
export const CORRIDAS_PARA_ESCALAR = 3;
/// Y tienen que abarcar al menos esto, de la primera a la ultima. Con dos
/// corridas automaticas por dia, 3 seguidas son ~24 h; sin este minimo, tres
/// clicks al boton del panel durante una caida de 10 minutos escalaban todo
/// lo que no respondio.
export const RACHA_MINIMA_MS = 20 * 60 * 60 * 1000;

export interface SinVerificar {
  externalId: string;
  permanente: boolean;
  /// Permanente: la frase corta ("falta el code de CDO"). Transitorio: el
  /// ultimo motivo (timeout, status...).
  motivo: string;
}

/// Ausentes "no verificados" de la ultima corrida completa que ya no se
/// pueden dejar en verde. Sin esto, un producto que nunca se puede verificar
/// (por ejemplo, de CDO y sin code guardado) quedaba activo y a la venta
/// para siempre, con el panel diciendo que se reintentaba.
/// - Motivo permanente: desde la primera corrida en que aparece.
/// - Motivo transitorio: si tampoco se pudo verificar en las
///   CORRIDAS_PARA_ESCALAR - 1 corridas anteriores, y esas corridas abarcan
///   al menos RACHA_MINIMA_MS.
///
/// Que cuenta como "seguidas": solo las corridas completas que llegaron a
/// CONFIRMAR ausentes. Se saltean las FAILED y las que frenaron el umbral
/// (las dos terminan sin preguntar nada al proveedor): no dicen nada del
/// producto. Contarlas como "verificado" cortaria la racha con cada falla
/// del proveedor; contarlas como "no verificado" escalaria por fallas que no
/// son del producto. Una corrida que SI lo verifica (o en la que volvio al
/// listado) la corta.
///
/// Solo los que siguen activos y sin borrar: pausado por cualquier camino,
/// ya esta resuelto.
export async function sinVerificarPendientes(run: {
  id: string;
  provider: ProductOrigin;
  summary: Prisma.JsonValue;
  finishedAt: Date | null;
}): Promise<SinVerificar[]> {
  const s = leerSummary(run);
  const ids = s?.noVerificados ?? [];
  if (ids.length === 0) return [];
  const detalle = s?.noVerificadosDetalle ?? {};
  const transitorios = ids.filter((id) => !detalle[id]?.permanente);

  let enRacha = new Set<string>();
  if (transitorios.length > 0 && run.finishedAt) {
    const anteriores = await prisma.syncRun.findMany({
      where: {
        provider: run.provider,
        status: SyncRunStatus.DONE,
        id: { not: run.id },
        finishedAt: { not: null, lt: run.finishedAt },
      },
      orderBy: { finishedAt: "desc" },
      // Se piden de mas: las que no confirmaron nada se saltean.
      take: 20,
      select: { summary: true, finishedAt: true },
    });
    const queConfirmaron = anteriores
      .map((r) => ({ s: leerSummary(r), finishedAt: r.finishedAt! }))
      .filter((x): x is { s: SyncRunSummary; finishedAt: Date } => x.s !== null && !x.s.umbralFrenado)
      .slice(0, CORRIDAS_PARA_ESCALAR - 1);
    const primera = queConfirmaron.at(-1);
    if (
      queConfirmaron.length === CORRIDAS_PARA_ESCALAR - 1 &&
      primera &&
      run.finishedAt.getTime() - primera.finishedAt.getTime() >= RACHA_MINIMA_MS
    ) {
      enRacha = new Set(
        transitorios.filter((id) => queConfirmaron.every((x) => (x.s.noVerificados ?? []).includes(id)))
      );
    }
  }

  const candidatos = ids.filter((id) => detalle[id]?.permanente || enRacha.has(id));
  if (candidatos.length === 0) return [];
  const activos = await prisma.product.findMany({
    where: {
      origin: run.provider,
      deletedAt: null,
      active: true,
      [idField(run.provider)]: { in: candidatos },
    },
    select: { zecatId: true, cdoId: true },
  });
  const activosSet = new Set(
    activos.map((p) => (run.provider === ProductOrigin.ZECAT ? p.zecatId : p.cdoId))
  );
  return candidatos
    .filter((id) => activosSet.has(id))
    .map((id) => ({
      externalId: id,
      permanente: detalle[id]?.permanente ?? false,
      motivo: detalle[id]?.motivo ?? "No se pudo verificar en las últimas corridas.",
    }));
}

/// "Pausar sin confirmación del proveedor": pausa ausentes que NO se pueden
/// verificar (los de sinVerificarPendientes), con una persona decidiendo.
///
/// Distinto de "Pausar estos N" a proposito: aquel pausa solo lo que el
/// proveedor CONFIRMA como baja, y esa garantia no se mezcla con esto. Por
/// eso no pasa por confirmarYPausar ni se registra en autoPausedExternalIds:
/// queda una nota en la ultima corrida completa con quien lo hizo.
///
/// La lista se recalcula aca: un id que no este en ella se rechaza (una
/// Server Action se puede invocar con cualquier id). Si el producto vuelve
/// al listado del proveedor, el sync lo reactiva como a cualquier otro
/// (en los dos conectores, `active` se recalcula en cada corrida).
export async function pausarSinConfirmacion(
  provider: ProductOrigin,
  externalIds: string[],
  adminEmail: string
): Promise<{ pausados: string[] }> {
  const ids = [...new Set(externalIds)];
  if (ids.length === 0) throw new Error("No hay productos para pausar.");
  const est = await estadoDelProveedor(provider);
  const permitidos = new Set(est.sinVerificar.map((x) => x.externalId));
  const fuera = ids.filter((id) => !permitidos.has(id));
  if (!est.ultimaCompleta) {
    throw new Error("No hay ninguna corrida completa del proveedor. No se pausó ninguno.");
  }
  if (fuera.length > 0) {
    throw new Error(
      `No están en la lista de productos que no se pueden verificar: ${fuera.join(", ")}. No se pausó ninguno.`
    );
  }
  const runId = est.ultimaCompleta.id;
  // La pausa y la nota de quien lo hizo van en la MISMA transaccion: pausar
  // sin dejar registro no puede pasar. Y si entre el calculo de la lista y
  // aca termino otra corrida, la lista ya no es la que vio el admin (el
  // producto pudo volver al listado): se aborta en vez de pausar a ciegas.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sync_runs WHERE id = ${runId} FOR UPDATE`;
    const ultima = await tx.syncRun.findFirst({
      where: { provider, status: SyncRunStatus.DONE, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { id: true },
    });
    if (ultima?.id !== runId) {
      throw new Error("Terminó una corrida nueva mientras tanto: recargá la página y revisá la lista. No se pausó ninguno.");
    }
    const aPausar = (
      await tx.product.findMany({
        where: { origin: provider, deletedAt: null, active: true, [idField(provider)]: { in: ids } },
        select: { zecatId: true, cdoId: true },
      })
    ).map((p) => (provider === ProductOrigin.ZECAT ? p.zecatId : p.cdoId) as string);
    await tx.product.updateMany({
      where: { origin: provider, deletedAt: null, active: true, [idField(provider)]: { in: aPausar } },
      data: { active: false },
    });
    const actual = await tx.syncRun.findUniqueOrThrow({ where: { id: runId }, select: { errors: true } });
    await tx.syncRun.update({
      where: { id: runId },
      data: {
        errors: [
          ...(actual.errors as Prisma.JsonArray),
          {
            externalId: "-",
            message:
              `Pausar sin confirmación del proveedor: ${adminEmail} el ${new Date().toISOString()}. ` +
              `Pausó ${aPausar.length} que no se podían verificar: ${aPausar.join(", ")}.`,
          },
        ],
      },
    });
    return { pausados: aPausar };
  });
}

/// Los "a revisar" de una corrida (detalle sano fuera del listado) que
/// todavia estan ACTIVOS. Si se pausaron por cualquier camino, ya no
/// cuentan. Si volvieron al listado, la corrida siguiente es la nueva
/// "ultima completa" y ya no los tiene en su lista.
async function aRevisarPendientes(run: {
  provider: ProductOrigin;
  summary: Prisma.JsonValue;
}): Promise<string[]> {
  const ids = leerSummary(run)?.aRevisar ?? [];
  if (ids.length === 0) return [];
  const activos = await prisma.product.findMany({
    where: {
      origin: run.provider,
      deletedAt: null,
      active: true,
      [idField(run.provider)]: { in: ids },
    },
    select: { zecatId: true, cdoId: true },
  });
  const activosSet = new Set(
    activos.map((p) => (run.provider === ProductOrigin.ZECAT ? p.zecatId : p.cdoId))
  );
  return ids.filter((id) => activosSet.has(id));
}

/// De donde salio una corrida, para mostrar: el cron firma "cron", la
/// consola "consola", el panel el email de quien apreto.
export function origenDeCorrida(startedBy: string): string {
  if (startedBy === "cron") return "automática";
  if (startedBy === "consola") return "consola";
  return `panel, ${startedBy}`;
}

/// Umbral de seguridad de un proveedor: max(piso, X% de sus activos), con X
/// de Supplier.autoPauseMaxPercent (5 si la fila todavia no existe, el mismo
/// default del schema). Solo lee: lo usa tambien el sync de CDO, que no
/// tiene SyncRun, para frenar ANTES de escribir.
export async function umbralDeSeguridad(provider: ProductOrigin) {
  const [activos, supplier] = await Promise.all([
    prisma.product.count({
      where: { origin: provider, active: true, deletedAt: null },
    }),
    prisma.supplier.findUnique({ where: { origin: provider } }),
  ]);
  const porcentaje = supplier ? Number(supplier.autoPauseMaxPercent) : 5;
  return {
    umbral: Math.max(AUTO_PAUSE_FLOOR, Math.floor((activos * porcentaje) / 100)),
    activos,
    porcentaje,
  };
}

/// Lo que esta corrida hizo con las variantes, y alerta si fue demasiado.
///
/// Se DERIVA de la base en vez de acumularse por batch: una variante
/// desactivada en esta corrida es una inactiva cuyo updatedAt es posterior
/// al inicio (el updateMany del sync lo renueva; las que ya estaban
/// inactivas no se tocan). Asi no hace falta una columna nueva.
///
/// Limite conocido: una variante que el PROVEEDOR manda con active:false
/// tambien queda inactiva con updatedAt renovado (el upsert lo renueva en
/// cada corrida), y se cuenta aunque no se haya "dejado de mandar". Hoy no
/// pasa: en produccion no hay una sola variante inactiva (medido el
/// 2026-10-14). El conteo exacto, por transicion, llega con el resumen
/// persistido de la corrida (etapa B).
///
/// Nunca tira: es un conteo y una alerta. Si falla, finishSyncRun tiene que
/// seguir y marcar la corrida DONE igual.
///
/// Por que solo alerta y no frena: a esta altura ya se aplico (cada
/// producto se escribe en su transaccion, durante la corrida), y se
/// revierte sola en la proxima corrida sana. El caso que no puede esperar
/// —una respuesta rota del proveedor, con TODO vacio— lo corta antes de
/// escribir la guarda por tanda del motor (lib/sync/motor.ts).
async function revisarVariantes(
  run: { id: string; provider: ProductOrigin; startedAt: Date },
  umbralProductos: number,
  supplier: { autoPauseMaxPercent: Prisma.Decimal }
) {
  const desde = run.startedAt;
  const [desactivadas, variantesActivas, productosSinVariantes] =
    await Promise.all([
      prisma.productVariant.count({
        where: {
          active: false,
          updatedAt: { gte: desde },
          product: { origin: run.provider },
        },
      }),
      prisma.productVariant.count({
        where: {
          active: true,
          product: { origin: run.provider, active: true, deletedAt: null },
        },
      }),
      // VACIADOS por esta corrida: sin ninguna variante activa, y con alguna
      // variante escrita en esta corrida (la que se desactivo). Un producto
      // que ya estaba vacio desde antes no tiene variantes tocadas — el
      // updateMany del sync solo toca las activas — asi que no suma: contar
      // el estado en vez de la transicion haria que un grupo estable de
      // vacios disparara la alerta en cada corrida.
      prisma.product.findMany({
        where: {
          origin: run.provider,
          deletedAt: null,
          lastSyncedAt: { gte: desde },
          variants: {
            none: { active: true },
            some: { updatedAt: { gte: desde } },
          },
        },
        select: { zecatId: true, cdoId: true, name: true },
      }),
    ]);

  // Mismo criterio que los ausentes: piso absoluto y el % del proveedor,
  // aplicado a lo que se mide (productos por un lado, variantes por otro).
  const umbralVariantes = Math.max(
    AUTO_PAUSE_FLOOR,
    Math.floor(
      (variantesActivas * Number(supplier.autoPauseMaxPercent)) / 100
    )
  );

  if (
    productosSinVariantes.length > umbralProductos ||
    desactivadas > umbralVariantes
  ) {
    await sendSyncAlert({
      provider: run.provider,
      motivo: "variantes",
      runId: run.id,
      desactivadas,
      umbralVariantes,
      umbralProductos,
      productosSinVariantes: productosSinVariantes.map((p) => ({
        externalId:
          (run.provider === ProductOrigin.ZECAT ? p.zecatId : p.cdoId) ?? "?",
        nombre: p.name,
        stockDisponible: null,
      })),
    });
  }

  return { desactivadas, productosSinVariantes };
}

/// Nombre y ultimo stock disponible conocido de los ausentes, para que la
/// alerta del umbral se pueda revisar sin abrir la base. El stock es el de
/// la ultima corrida que los vio (stock - reservado, sumado por producto).
export async function describirAusentes(
  provider: ProductOrigin,
  externalIds: string[]
): Promise<AusenteAlerta[]> {
  const idField = provider === ProductOrigin.ZECAT ? "zecatId" : "cdoId";
  // El detalle es un extra del mail: si la consulta falla, la alerta sale
  // igual con los ids pelados. Tirar aca rompería finishSyncRun antes de
  // marcar DONE, y una corrida completa quedaría FAILED por un adorno.
  let productos;
  try {
    productos = await prisma.product.findMany({
      where: { origin: provider, [idField]: { in: externalIds } },
      select: {
        zecatId: true,
        cdoId: true,
        name: true,
        variants: { select: { stock: true, reservedStock: true } },
      },
    });
  } catch (error) {
    console.error("[sync-run] No se pudo describir los ausentes para la alerta:", error);
    return externalIds.map((externalId) => ({
      externalId,
      nombre: null,
      stockDisponible: null,
    }));
  }
  const porId = new Map(
    productos.map((p) => [
      provider === ProductOrigin.ZECAT ? p.zecatId : p.cdoId,
      {
        nombre: p.name,
        stock: p.variants.reduce(
          (total, v) => total + Math.max(v.stock - v.reservedStock, 0),
          0
        ),
      },
    ])
  );
  return externalIds.map((externalId) => ({
    externalId,
    nombre: porId.get(externalId)?.nombre ?? null,
    stockDisponible: porId.get(externalId)?.stock ?? null,
  }));
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

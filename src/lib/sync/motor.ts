import { Prisma, ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendSyncAlert } from "@/lib/email";
import type { CambiosDeTick } from "@/lib/cache-tags";
import { invalidaCache } from "@/lib/sync/cambios";
import {
  finishSyncRun,
  pausadosDeError,
  leerSummary,
  rachaSinFotoActiva,
  umbralDeSeguridad,
  type SyncRunSummary,
} from "@/lib/sync-run";
import {
  conectorDe,
  type Carga,
  type Conector,
  type ContextoSincronizar,
  type ResultadoSincronizar,
} from "@/lib/sync/conectores";

/// El motor del sync: avanza UNA corrida de un proveedor durante un tick y
/// corta. Lo llaman el cron (cada minuto dentro de la ventana), el boton del
/// panel (el navegador conduce el loop) y la consola — los tres con el mismo
/// lease, asi que pueden intercalarse sobre la misma corrida sin pisarse.
///
/// El trabajo vive en la base, no en quien lo conduce: la lista congelada
/// (plannedExternalIds) y el cursor (indice sobre esa lista). Cualquier
/// invocacion que tome el lease sigue desde donde quedo la anterior.
///
/// FENCING: el valor de leaseUntil que pone cada invocacion al tomar el
/// lease es su ficha de dueño. Toda escritura sobre la corrida exige
/// "leaseUntil = mi ficha": una invocacion que se colgo mas de 150 s (la
/// consola con la laptop suspendida, por ejemplo) y despierta tarde no puede
/// retroceder el cursor, pisar contadores ni liberar el lease de otra.

/// Cuanto dura el derecho a escribir de una invocacion. Mayor que el
/// maxDuration de la ruta (120 s): mientras la funcion vive, su lease no
/// vence. Vencido sin liberar = la invocacion murio.
export const LEASE_MS = 150_000;

/// Presupuesto de un tick para procesar productos: se corta ENTRE productos
/// (entre tandas), nunca en el medio. Se baja por variable de entorno para
/// probar cortes (SYNC_TICK_BUDGET_MS=5000).
export function presupuestoTick(): number {
  const desdeEnv = Number(process.env.SYNC_TICK_BUDGET_MS);
  return Number.isFinite(desdeEnv) && desdeEnv > 0 ? desdeEnv : 45_000;
}

/// El cierre (confirmar ausentes, resumen) puede tardar hasta ~75 s si el
/// proveedor esta lento. Solo se hace si el tick lleva menos que esto; si
/// no, queda para el proximo tick, que arranca con el reloj en cero.
const MAX_TRANSCURRIDO_PARA_CERRAR_MS = 20_000;

/// Una corrida cuya lista se congelo hace mas de esto ya no describe el
/// catalogo: se cierra FAILED ("lista vencida") y se arranca una nueva. Menor
/// que las 12 h entre ventanas, asi una corrida nunca pasa de una ventana a
/// la siguiente con datos de medio dia atras.
export const LISTA_VENCE_MS = 6 * 60 * 60 * 1000;

/// El cron solo arranca una corrida nueva si la ultima completa tiene mas de
/// esto (con dos ventanas por dia, cada ventana arranca una).
export const NUEVA_CORRIDA_CADA_MS = 6 * 60 * 60 * 1000;

/// Las ventanas del cron de cada proveedor: hora UTC de inicio y duracion en
/// minutos. TIENEN que coincidir con vercel.json. CDO va desfasado una hora
/// de Zecat: no compiten por la base ni por los ticks.
/// - Zecat: "0-29 9,21 * * *"  (06:00 a 06:29 y 18:00 a 18:29 ART)
/// - CDO:   "0-29 10,22 * * *" (07:00 a 07:29 y 19:00 a 19:29 ART)
///
/// 30 minutos (eran 2 h hasta 2026-10-15): cada tick pega a la base aunque
/// no haya nada que hacer, y con la cache cargada una corrida entra holgada.
/// Alcanzan para el peor caso de reintentos: 3 corridas con 10 min entre
/// fallidas (minutos 0, 10 y 20).
///
/// Una corrida que NO termina en su ventana queda RUNNING hasta la
/// siguiente (12 h despues); ahi su lista ya vencio (LISTA_VENCE_MS), se
/// cierra FAILED y arranca una nueva en el mismo tick. No se pierde todo: en
/// CDO las imagenes medidas quedan en la cache, asi que la corrida nueva
/// avanza mucho mas rapido. La primera corrida de CDO (cache vacia: ~26 min
/// medidos en local) se hace desde el panel, que no tiene ventana.
export const VENTANAS_UTC: Partial<Record<ProductOrigin, ReadonlyArray<{ desde: number; minutos: number }>>> = {
  [ProductOrigin.ZECAT]: [
    { desde: 9, minutos: 30 },
    { desde: 21, minutos: 30 },
  ],
  [ProductOrigin.CDO]: [
    { desde: 10, minutos: 30 },
    { desde: 22, minutos: 30 },
  ],
};

/// Tope de corridas que el cron arranca por ventana, y espera despues de una
/// fallida. Con el proveedor caido, sin esto serian hasta 120 corridas
/// FAILED por ventana. Retomar una RUNNING no cuenta.
export const MAX_INTENTOS_CRON_POR_VENTANA = 3;
export const ESPERA_TRAS_FALLA_MS = 10 * 60 * 1000;

/// Tamaño de la tanda: se cargan de a 5 detalles en paralelo, y si TODOS
/// vienen sin variantes, la respuesta esta rota y se corta ANTES de escribir
/// (la guarda de A2, ahora sobre la lista congelada en vez de paginas).
export const TANDA = 5;

/// Errores transitorios (un corte de red o de la base) antes de dar la
/// corrida por FAILED. La corrida no se pierde por un estornudo: el avance
/// esta en la base y el tick siguiente sigue.
export const MAX_ERRORES_TRANSITORIOS = 3;

export const NOTA_INVOCACION_CORTADA = "Invocación cortada";
export const NOTA_ERROR_TRANSITORIO = "Error transitorio del tick";

/// La corrida no puede seguir: la respuesta del proveedor esta rota (tanda
/// vacia) o no se pudo armar la lista. Reintentar el tick no lo arregla.
export class ErrorDeterminista extends Error {}

/// Otra invocacion tomo el lease (la nuestra vencio): no se escribe nada mas.
class LeasePerdido extends Error {}

export type ResultadoTick =
  /// El cron no tenia nada que hacer (o no podia arrancar: tope, espera).
  | { estado: "sin-corrida"; motivo: string }
  /// Otra invocacion tiene el lease: quien llamo espera y reintenta.
  | { estado: "ocupado"; runId: string; startedBy: string; procesados: number; total: number | null }
  | { estado: "avanzo"; runId: string; startedBy: string; procesados: number; total: number }
  | { estado: "completa"; runId: string; summary: SyncRunSummary }
  | { estado: "fallo"; runId: string; mensaje: string };

/// El lease de esta invocacion: la corrida y la ficha (el leaseUntil que
/// puso). Se actualiza al renovar.
interface Lease {
  runId: string;
  ficha: Date;
}

/// Avanza la corrida RUNNING del proveedor durante un tick, o arranca una.
///
/// - `startedBy`: "cron", "consola" o el email del admin. Solo se usa si hay
///   que crear la corrida: retomar no pisa quien la empezo.
/// - `esCron`: aplica las reglas del disparo automatico (arrancar solo si la
///   ultima completa tiene mas de 6 h, tope por ventana, espera tras falla).
///   El panel y la consola arrancan siempre, sin tope: los dispara una persona.
/// - `siguiendo`: la corrida que viene acompañando quien llama (el loop del
///   panel o de la consola). Si otro la termino, se devuelve su resultado en
///   vez de arrancar otra.
///
/// El resultado trae `cambios`: los Product.id cuya ficha publica cambio en
/// este tick (ver lib/sync/cambios.ts), SEA CUAL SEA el estado del tick
/// (avanzo, completa, fallo, ocupado). Quien llama (cron, panel) invalida la
/// cache publica con invalidarPorCambios(). La consola no puede: corre fuera
/// de Next, y la tienda se pone al dia por TTL o con "Refrescar tienda".
/// La invalidacion NO depende de este resultado: el conector deja una marca
/// en la base (Product.invalidacionPendienteDesde) y el barrido de
/// lib/sync/invalidaciones.ts la levanta aunque el tick tire o el proceso
/// muera. `cambios` queda para diagnostico y para las verificaciones.
export async function avanzarCorrida(
  provider: ProductOrigin,
  startedBy: string,
  opciones: { esCron: boolean; ahora?: Date; siguiendo?: string } = { esCron: false }
): Promise<ResultadoTick & { cambios: CambiosDeTick }> {
  const acumulado = new Set<string>();
  const resultado = await avanzarCorridaInterna(provider, startedBy, opciones, acumulado);
  return { ...resultado, cambios: { productIds: [...acumulado] } };
}

async function avanzarCorridaInterna(
  provider: ProductOrigin,
  startedBy: string,
  opciones: { esCron: boolean; ahora?: Date; siguiendo?: string },
  acumulado: Set<string>
): Promise<ResultadoTick> {
  const conector = conectorDe(provider);
  if (!conector) throw new Error(`El proveedor ${provider} todavía no corre sobre el motor del sync.`);

  if (opciones.siguiendo) {
    const seguida = await prisma.syncRun.findUnique({ where: { id: opciones.siguiendo } });
    if (seguida && seguida.status !== SyncRunStatus.RUNNING) return resultadoDeTerminada(seguida);
  }

  // A lo sumo dos vueltas: si la corrida abierta tenia la lista vencida (o
  // termino entre medio), se intenta con la que corresponda.
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    const ahora = opciones.ahora ?? new Date();
    let run = await prisma.syncRun.findFirst({
      where: { provider, status: SyncRunStatus.RUNNING },
    });

    if (!run) {
      if (opciones.esCron) {
        const noArrancar = await motivoParaNoArrancar(provider, ahora);
        if (noArrancar) return { estado: "sin-corrida", motivo: noArrancar };
      }
      run = await crearCorrida(provider, startedBy, ahora);
    }

    const toma = await tomarLease(run.id, ahora);
    if (!toma.ok) {
      const actual = await prisma.syncRun.findUniqueOrThrow({ where: { id: run.id } });
      if (actual.status !== SyncRunStatus.RUNNING) continue; // termino entre medio
      return ocupado(actual);
    }
    const lease: Lease = { runId: run.id, ficha: toma.ficha };

    try {
      if (toma.murioAnterior) await avisarSiSeCortaDeNuevo(run.id, provider);

      // Lista vencida: se cierra y, en la vuelta siguiente, se intenta una nueva.
      if (ahora.getTime() - run.startedAt.getTime() > LISTA_VENCE_MS) {
        await fallar(
          lease,
          `Lista vencida: se congeló hace más de ${LISTA_VENCE_MS / 3_600_000} h y ya no describe el catálogo. Se arranca una corrida nueva.`
        );
        continue;
      }

      return await trabajar(lease, conector, acumulado);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      if (error instanceof LeasePerdido) {
        // Otro tomo la corrida: no se escribe nada (ni fallo, ni liberar).
        return ocupado(await prisma.syncRun.findUniqueOrThrow({ where: { id: run.id } }));
      }
      if (error instanceof ErrorDeterminista) {
        await fallar(lease, mensaje);
        return { estado: "fallo", runId: run.id, mensaje };
      }
      // Transitorio: se anota y la corrida sigue RUNNING. Al tercero, FAILED.
      const errores = await anotarErrorTransitorio(lease, mensaje);
      if (errores >= MAX_ERRORES_TRANSITORIOS) {
        await fallar(lease, `${MAX_ERRORES_TRANSITORIOS} errores transitorios seguidos; el último: ${mensaje}`);
        return { estado: "fallo", runId: run.id, mensaje };
      }
      const actual = await prisma.syncRun.findUniqueOrThrow({ where: { id: run.id } });
      return {
        estado: "avanzo",
        runId: run.id,
        startedBy: actual.startedBy,
        procesados: actual.cursor ?? 0,
        total: (actual.plannedExternalIds as string[] | null)?.length ?? 0,
      };
    } finally {
      await liberarLease(lease);
    }
  }
  return { estado: "sin-corrida", motivo: "No se pudo tomar ninguna corrida en este tick." };
}

function ocupado(run: {
  id: string;
  startedBy: string;
  cursor: number | null;
  plannedExternalIds: Prisma.JsonValue;
}): ResultadoTick {
  return {
    estado: "ocupado",
    runId: run.id,
    startedBy: run.startedBy,
    procesados: run.cursor ?? 0,
    total: (run.plannedExternalIds as string[] | null)?.length ?? null,
  };
}

async function trabajar(lease: Lease, conector: Conector, acumulado: Set<string>): Promise<ResultadoTick> {
  const inicio = Date.now();
  let run = await prisma.syncRun.findUniqueOrThrow({ where: { id: lease.runId } });

  // Primera vez: congelar la lista. Despues, nunca se vuelve a pedir.
  if (run.plannedExternalIds === null) {
    let lista: { ids: string[]; total: number };
    try {
      lista = await conector.listar();
    } catch (error) {
      // Sin lista no hay corrida: es determinista para este tick (y el tope
      // de reintentos del cron decide cuando volver a probar).
      throw new ErrorDeterminista(
        `No se pudo armar la lista de ${conector.nombre}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    await escribirSiSoyDueño(lease, {
      plannedExternalIds: lista.ids,
      totalRemote: lista.total,
      cursor: 0,
      heartbeatAt: new Date(),
    });
    run = await prisma.syncRun.findUniqueOrThrow({ where: { id: lease.runId } });
  }
  const lista = run.plannedExternalIds as string[];
  let cursor = run.cursor ?? 0;

  // Tope de apagados por "sin foto": al llegar al umbral de seguridad, los
  // siguientes productos que se queden sin foto CONSERVAN su estado. Un 403
  // en masa de la CDN (un cambio de permisos del lado del proveedor) se ve
  // igual que fotos rotas de verdad, y como cada producto se escribe durante
  // la corrida, una alerta al cierre llegaria con el catalogo ya apagado.
  // El conteo se lee bajo el lease (nadie mas escribe esta corrida) y se
  // sigue en memoria durante el tick. El umbral usa los activos de ahora: a
  // medida que se apagan productos baja, nunca sube.
  //
  // Ademas el tope es por RACHA: si la ultima corrida completa ya llego al
  // tope, esta no apaga ninguno (ver rachaSinFotoActiva).
  const { umbral: umbralSinFoto } = await umbralDeSeguridad(conector.provider);
  const enRachaSinFoto = await rachaSinFotoActiva(conector.provider, lease.runId);
  let apagadosSinFoto = (run.sinFotoExternalIds as Array<{ retenido: boolean }>).filter((x) => !x.retenido).length;

  while (cursor < lista.length && Date.now() - inicio < presupuestoTick()) {
    const ids = lista.slice(cursor, cursor + TANDA);
    const cargas = await Promise.all(ids.map((id) => conector.cargar(id)));

    // Guarda: una tanda completa de detalles TODOS sin variantes no es una
    // reposicion pendiente, es una respuesta rota. Se corta antes de
    // escribir: con esto el proveedor no puede apagar el catalogo producto
    // por producto devolviendo variantes vacias. (Los casos parciales —
    // muchos vacios pero no una tanda entera — los mide y avisa el cierre:
    // ver revisarVariantes en lib/sync-run.ts.)
    const ok = cargas.filter((c): c is Extract<Carga, { tipo: "ok" }> => c.tipo === "ok");
    if (ok.length >= TANDA && ok.every((c) => conector.sinVariantes(c.producto))) {
      throw new ErrorDeterminista(
        `Respuesta anómala de ${conector.nombre}: los ${ok.length} productos de la tanda (posiciones ${cursor + 1} a ${cursor + ids.length}) vinieron sin variantes. No se escribió nada de esa tanda.`
      );
    }

    for (let i = 0; i < ids.length; i++) {
      const sinFoto = await procesarUno(lease, cursor + 1, ids[i], cargas[i], conector, {
        puedeApagarSinFoto: !enRachaSinFoto && apagadosSinFoto < umbralSinFoto,
      }, acumulado);
      if (sinFoto === "apagado") apagadosSinFoto++;
      cursor++;
      // Si cargar es gratis (CDO: el producto ya esta en memoria), el
      // presupuesto se mira tambien ENTRE productos: en CDO cada producto
      // mide sus imagenes (cache vacia: ~23 por producto) y una tanda entera
      // se pasaba 20-25 s del presupuesto (medido). Cortar aca no pierde
      // nada: el cursor avanzo producto por producto. En Zecat se corta solo
      // entre tandas, para no volver a pedir detalles ya pedidos.
      if (conector.cargaGratis && Date.now() - inicio >= presupuestoTick()) break;
    }
    // Renueva el lease (y el latido) entre tandas: es trabajo vivo.
    await renovar(lease);
  }

  if (cursor >= lista.length) {
    if (Date.now() - inicio > MAX_TRANSCURRIDO_PARA_CERRAR_MS) {
      // El cierre puede ser largo: mejor en un tick que arranque fresco.
      return { estado: "avanzo", runId: lease.runId, startedBy: run.startedBy, procesados: cursor, total: lista.length };
    }
    // Antes de cerrar, confirmar que la corrida sigue siendo nuestra.
    await renovar(lease);
    let fin;
    try {
      fin = await finishSyncRun(lease.runId);
    } catch (error) {
      // Si el cierre pauso ausentes por tandas y despues tiro, esos productos
      // ya estan inactivos: sus ids tienen que llegar a la invalidacion.
      for (const id of pausadosDeError(error)) acumulado.add(id);
      throw error;
    }
    // Lo que el cierre pauso por ausente confirmado: su `active` cambio.
    for (const id of fin.pausadosIds) acumulado.add(id);
    if (fin.aborted) {
      const errores = fin.run.errors as Array<{ message: string }>;
      return { estado: "fallo", runId: lease.runId, mensaje: errores.at(-1)?.message ?? "Corrida abortada." };
    }
    return { estado: "completa", runId: lease.runId, summary: fin.summary };
  }
  return { estado: "avanzo", runId: lease.runId, startedBy: run.startedBy, procesados: cursor, total: lista.length };
}

function resultadoDeTerminada(run: {
  id: string;
  status: SyncRunStatus;
  summary: Prisma.JsonValue;
  errors: Prisma.JsonValue;
}): ResultadoTick {
  const summary = leerSummary(run);
  if (run.status === SyncRunStatus.DONE && summary) {
    return { estado: "completa", runId: run.id, summary };
  }
  const errores = run.errors as Array<{ externalId: string; message: string }>;
  return {
    estado: "fallo",
    runId: run.id,
    mensaje: errores.filter((e) => e.externalId === "-").at(-1)?.message ?? "sin detalle",
  };
}

/// Procesa un producto y registra el avance EN EL MISMO PASO que mueve el
/// cursor: si la invocacion muere entre dos productos, la siguiente sigue
/// exacto desde el que falta. (Si muere justo entre el upsert del producto y
/// este registro, ese producto se procesa dos veces: el upsert es
/// idempotente, solo el contador de actualizados suma uno de mas.)
async function procesarUno(
  lease: Lease,
  nuevoCursor: number,
  id: string,
  carga: Carga,
  conector: Conector,
  contexto: ContextoSincronizar,
  acumulado: Set<string>
): Promise<ResultadoSincronizar["sinFoto"]> {
  const delta = { creados: 0, actualizados: 0, pausados: 0, fallidos: 0, moneda: 0 };
  let sinFoto: ResultadoSincronizar["sinFoto"];
  let visto = true;
  let error: { externalId: string; message: string } | null = null;

  if (carga.tipo === "ausente") {
    // 404 a mitad de corrida: el proveedor lo saco. NO es un fallo: queda
    // fuera de "vistos" y el cierre lo trata como ausente (confirmacion y
    // umbral incluidos).
    visto = false;
  } else if (carga.tipo === "error") {
    delta.fallidos = 1;
    error = { externalId: id, message: carga.mensaje };
  } else {
    try {
      const r = await conector.sincronizar(carga.producto, contexto);
      sinFoto = r.sinFoto;
      // Solo lo que el cliente nota: cambio publico (incluye altas, pausas y
      // apagados por foto) o stock que cruza el cero. El otro stock lo absorbe el TTL.
      if (r.productId && r.cambio && invalidaCache(r.cambio)) acumulado.add(r.productId);
      if (r.resultado === "creado") delta.creados = 1;
      else if (r.resultado === "actualizado") delta.actualizados = 1;
      else delta.pausados = 1;
      if (r.monedaSospechosa) delta.moneda = 1;
    } catch (e) {
      delta.fallidos = 1;
      error = { externalId: id, message: e instanceof Error ? e.message : String(e) };
    }
  }

  // Un solo UPDATE: cursor, contadores, visto y error juntos, y SOLO si el
  // lease sigue siendo nuestro (fencing). GREATEST por las dudas: el cursor
  // nunca retrocede.
  const filas = await prisma.$executeRaw`
    UPDATE sync_runs SET
      cursor = GREATEST(COALESCE(cursor, 0), ${nuevoCursor}),
      created = created + ${delta.creados},
      updated = updated + ${delta.actualizados},
      paused = paused + ${delta.pausados},
      failed = failed + ${delta.fallidos},
      "usdWarnings" = "usdWarnings" + ${delta.moneda},
      "seenExternalIds" = CASE WHEN ${visto} THEN "seenExternalIds" || to_jsonb(${id}::text) ELSE "seenExternalIds" END,
      errors = CASE WHEN ${error !== null} THEN errors || ${JSON.stringify(error ? [error] : [])}::jsonb ELSE errors END,
      "sinFotoExternalIds" = CASE WHEN ${sinFoto !== undefined} THEN "sinFotoExternalIds" || ${JSON.stringify(sinFoto ? [{ id, retenido: sinFoto === "retenido" }] : [])}::jsonb ELSE "sinFotoExternalIds" END,
      "heartbeatAt" = ${new Date()}
    WHERE id = ${lease.runId} AND "leaseUntil" = ${lease.ficha} AND status = 'RUNNING'`;
  if (filas !== 1) throw new LeasePerdido();
  return sinFoto;
}

/// Escribe en la corrida solo si el lease sigue siendo nuestro.
async function escribirSiSoyDueño(lease: Lease, data: Prisma.SyncRunUpdateManyMutationInput) {
  const r = await prisma.syncRun.updateMany({
    where: { id: lease.runId, leaseUntil: lease.ficha, status: SyncRunStatus.RUNNING },
    data,
  });
  if (r.count !== 1) throw new LeasePerdido();
}

/// Renueva el lease (nueva ficha) y el latido. Tira LeasePerdido si otro lo
/// tomo mientras tanto.
async function renovar(lease: Lease) {
  const nueva = new Date(Date.now() + LEASE_MS);
  await escribirSiSoyDueño(lease, { leaseUntil: nueva, heartbeatAt: new Date() });
  lease.ficha = nueva;
}

/// Cierra la corrida como FAILED, solo si sigue siendo nuestra.
async function fallar(lease: Lease, mensaje: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sync_runs WHERE id = ${lease.runId} FOR UPDATE`;
    const run = await tx.syncRun.findUniqueOrThrow({ where: { id: lease.runId } });
    if (run.status !== SyncRunStatus.RUNNING || run.leaseUntil?.getTime() !== lease.ficha.getTime()) {
      throw new LeasePerdido();
    }
    await tx.syncRun.update({
      where: { id: lease.runId },
      data: {
        status: SyncRunStatus.FAILED,
        finishedAt: new Date(),
        errors: [...(run.errors as Prisma.JsonArray), { externalId: "-", message: mensaje }],
      },
    });
  });
}

/// Anota un error transitorio y devuelve cuantos lleva la corrida desde el
/// ultimo producto procesado. Si la base no responde, esto tambien tira: la
/// invocacion termina con error y el lease vence solo.
async function anotarErrorTransitorio(lease: Lease, mensaje: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sync_runs WHERE id = ${lease.runId} FOR UPDATE`;
    const run = await tx.syncRun.findUniqueOrThrow({ where: { id: lease.runId } });
    if (run.status !== SyncRunStatus.RUNNING || run.leaseUntil?.getTime() !== lease.ficha.getTime()) {
      return 0;
    }
    const errores = [
      ...(run.errors as Array<{ externalId: string; message: string }>),
      { externalId: "-", message: `${NOTA_ERROR_TRANSITORIO} (cursor ${run.cursor ?? 0}): ${mensaje}` },
    ];
    await tx.syncRun.update({ where: { id: lease.runId }, data: { errors: errores } });
    // Seguidos: los transitorios anotados con el MISMO cursor (sin avance
    // entre medio). Si el cursor se movio, la racha se corta.
    const marca = `${NOTA_ERROR_TRANSITORIO} (cursor ${run.cursor ?? 0}):`;
    return errores.filter((e) => e.message.startsWith(marca)).length;
  });
}

/// Toma el lease con la fila BLOQUEADA (SELECT … FOR UPDATE): la base decide
/// quien gana. Devuelve la ficha (el leaseUntil que quedo puesto). Si el
/// lease anterior vencio sin liberarse, la invocacion que lo tenia murio:
/// se anota y se sigue (el trabajo hecho ya esta registrado).
export async function tomarLease(
  runId: string,
  ahora: Date = new Date()
): Promise<{ ok: true; murioAnterior: boolean; ficha: Date } | { ok: false }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sync_runs WHERE id = ${runId} FOR UPDATE`;
    const run = await tx.syncRun.findUniqueOrThrow({
      where: { id: runId },
      select: { status: true, leaseUntil: true, errors: true },
    });
    if (run.status !== SyncRunStatus.RUNNING) return { ok: false as const };
    if (run.leaseUntil && run.leaseUntil > ahora) return { ok: false as const };

    const murioAnterior = run.leaseUntil !== null;
    // La ficha tiene que ser distinta de la anterior (es la identidad del
    // dueño): si coincidiera al milisegundo, se corre uno.
    let ficha = new Date(ahora.getTime() + LEASE_MS);
    if (run.leaseUntil && run.leaseUntil.getTime() === ficha.getTime()) {
      ficha = new Date(ficha.getTime() + 1);
    }
    await tx.syncRun.update({
      where: { id: runId },
      data: {
        leaseUntil: ficha,
        heartbeatAt: ahora,
        ...(murioAnterior
          ? {
              errors: [
                ...(run.errors as Prisma.JsonArray),
                {
                  externalId: "-",
                  message: `${NOTA_INVOCACION_CORTADA}: el lease venció sin liberarse (${run.leaseUntil!.toISOString()}); se continúa desde el cursor.`,
                },
              ],
            }
          : {}),
      },
    });
    return { ok: true as const, murioAnterior, ficha };
  });
}

/// Libera el lease, solo si sigue siendo nuestro. Nunca tira: si falla, el
/// lease vence solo en 150 s (y el siguiente lo anota como invocacion
/// cortada, que es lo que fue).
async function liberarLease(lease: Lease) {
  try {
    await prisma.syncRun.updateMany({
      where: { id: lease.runId, leaseUntil: lease.ficha },
      data: { leaseUntil: null },
    });
  } catch (error) {
    console.error("[motor] No se pudo liberar el lease:", error);
  }
}

/// Una invocacion cortada suelta es ruido (red, un deploy); dos sobre la
/// misma corrida son un patron. El mail sale en la SEGUNDA, una sola vez.
async function avisarSiSeCortaDeNuevo(runId: string, provider: ProductOrigin) {
  const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId }, select: { errors: true } });
  const cortes = (run.errors as Array<{ message: string }>).filter((e) =>
    e.message.startsWith(NOTA_INVOCACION_CORTADA)
  ).length;
  if (cortes === 2) {
    await sendSyncAlert({
      provider,
      motivo: "fallo",
      runId,
      detalle:
        "La sincronización se cortó dos veces sin terminar su tramo (la función se quedó sin tiempo o se cayó). Se sigue desde donde quedó, pero si vuelve a pasar conviene revisar los logs de Vercel.",
    });
  }
}

/// startedAt sale del MISMO reloj que el resto del tick (`ahora`): las reglas
/// que lo comparan (lista vencida, intentos por ventana) no pueden mezclar
/// la hora del proceso con la de la base.
async function crearCorrida(provider: ProductOrigin, startedBy: string, ahora: Date) {
  try {
    return await prisma.syncRun.create({ data: { provider, startedBy, startedAt: ahora } });
  } catch (error) {
    // Otro llego primero (indice unico parcial: una sola RUNNING por
    // proveedor). No es un error: se trabaja sobre la suya.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.syncRun.findFirstOrThrow({
        where: { provider, status: SyncRunStatus.RUNNING },
      });
    }
    throw error;
  }
}

/// Inicio de la ventana del cron que contiene a `ahora` (o, fuera de toda
/// ventana —un llamado manual—, la hora UTC en curso).
export function inicioDeVentana(ahora: Date, provider: ProductOrigin = ProductOrigin.ZECAT): Date {
  const h = ahora.getUTCHours();
  const min = h * 60 + ahora.getUTCMinutes();
  const v = (VENTANAS_UTC[provider] ?? []).find((w) => min >= w.desde * 60 && min < w.desde * 60 + w.minutos);
  const inicio = new Date(ahora);
  inicio.setUTCHours(v ? v.desde : h, 0, 0, 0);
  return inicio;
}

/// Reglas del disparo automatico. Devuelve por que NO arrancar, o null.
export async function motivoParaNoArrancar(
  provider: ProductOrigin,
  ahora: Date
): Promise<string | null> {
  const ultimaCompleta = await prisma.syncRun.findFirst({
    where: { provider, status: SyncRunStatus.DONE, finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" },
  });
  if (ultimaCompleta?.finishedAt && ahora.getTime() - ultimaCompleta.finishedAt.getTime() < NUEVA_CORRIDA_CADA_MS) {
    return "Al día: la última corrida completa tiene menos de 6 h.";
  }

  const delCron = await prisma.syncRun.findMany({
    where: { provider, startedBy: "cron", startedAt: { gte: inicioDeVentana(ahora, provider) } },
    orderBy: { startedAt: "desc" },
  });
  if (delCron.length >= MAX_INTENTOS_CRON_POR_VENTANA) {
    return `Tope de ${MAX_INTENTOS_CRON_POR_VENTANA} corridas automáticas en esta ventana.`;
  }
  const ultima = delCron[0];
  if (
    ultima?.status === SyncRunStatus.FAILED &&
    ultima.finishedAt &&
    ahora.getTime() - ultima.finishedAt.getTime() < ESPERA_TRAS_FALLA_MS
  ) {
    return "Esperando 10 minutos después de una corrida fallida.";
  }
  return null;
}

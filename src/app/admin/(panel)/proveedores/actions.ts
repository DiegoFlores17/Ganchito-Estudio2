"use server";

import { ProductOrigin } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { invalidarCachePublico, tagsPorProductos } from "@/lib/cache-tags";
import { barrerSinFallar } from "@/lib/sync/invalidaciones";
import { requireAdmin, requireSuperAdmin } from "@/lib/admin-auth";
import {
  origenDeCorrida,
  pausadosDeError,
  pausarAusentesDeCorrida,
  pausarSinConfirmacion as pausarSinConfirmacionDeLib,
  type SyncRunSummary,
} from "@/lib/sync-run";
import { conectorDe } from "@/lib/sync/conectores";
import { avanzarCorrida } from "@/lib/sync/motor";
import { revisarAlertas } from "@/lib/sync/alertas";
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

export interface SyncTickResult {
  /// "ocupado": otra invocacion (el cron, otra pestaña, la consola) tiene la
  /// corrida en este momento — el navegador espera y reintenta.
  estado: "ocupado" | "avanzo" | "completa" | "fallo" | "sin-corrida";
  runId?: string;
  /// Quien empezo la corrida, para mostrar ("panel, alguien@…", "consola",
  /// "automática").
  origen?: string;
  procesados?: number;
  total?: number | null;
  /// Solo en "completa": el resumen fijo, el MISMO que lee el historial.
  summary?: SyncRunSummary;
  error?: string;
}

/// Un tick del sync desde el panel: avanza la corrida abierta del proveedor
/// (o arranca una) durante ~45 s y corta. El navegador lo llama en loop; ya
/// no le pasa una pagina: el cursor vive en la base, asi que el panel, el
/// cron y la consola pueden intercalarse sobre la misma corrida.
///
/// El panel arranca SIEMPRE (sin el tope ni la regla de 6 h del cron): lo
/// dispara una persona.
///
/// `siguiendo`: la corrida que el navegador viene acompañando. Si mientras
/// tanto la termino otro (el cron, otra pestaña), se devuelve su resultado en
/// vez de arrancar una corrida nueva: sin esto, el siguiente tick del panel
/// no encontraria ninguna abierta y empezaria otra corrida completa.
export async function syncTick(
  provider: ProductOrigin,
  siguiendo?: string
): Promise<SyncTickResult> {
  const admin = await requireAdmin();
  if (!conectorDe(provider)) {
    return { estado: "fallo", error: "Este proveedor todavía no se puede sincronizar desde el panel." };
  }

  // Barrido de invalidaciones pendientes en CADA tick, sea cual sea su
  // estado (y aunque tire): el sync escribe producto por producto y deja una
  // marca en la base por cada cambio que el cliente nota. Ver
  // lib/sync/invalidaciones.ts.
  let tick;
  try {
    tick = await avanzarCorrida(provider, admin.email, { esCron: false, siguiendo });
  } finally {
    await barrerSinFallar("proveedores");
  }

  if (tick.estado === "completa") {
    // Los costos pueden haber cambiado: el catalogo publico se refresca.
    revalidatePath("/catalogo");
    revalidatePath("/");
  }
  if (tick.estado === "completa" || tick.estado === "fallo") {
    // Mismo criterio que el cron: avisa por cambio de estado, no repite. Si
    // falla, no tapa el resultado de la corrida.
    try {
      await revisarAlertas(provider);
    } catch (error) {
      console.error("[proveedores] No se pudieron revisar las alertas:", error);
    }
  }

  switch (tick.estado) {
    case "ocupado":
    case "avanzo":
      return {
        estado: tick.estado,
        runId: tick.runId,
        origen: origenDeCorrida(tick.startedBy),
        procesados: tick.procesados,
        total: tick.total,
      };
    case "completa":
      return { estado: "completa", runId: tick.runId, summary: tick.summary };
    case "fallo":
      return { estado: "fallo", runId: tick.runId, error: `La sincronización falló: ${tick.mensaje}` };
    default:
      return { estado: "sin-corrida", error: tick.motivo };
  }
}

/// Interruptor del sync automatico. Solo super-admin: cambia como funciona
/// el sistema (que corra solo dos veces por dia o no), no es operacion del
/// dia a dia.
export async function setAutoSync(
  provider: ProductOrigin,
  activado: boolean
): Promise<{ success: boolean; error?: string }> {
  await requireSuperAdmin();
  if (!conectorDe(provider)) {
    return { success: false, error: "Este proveedor todavía no tiene sincronización automática." };
  }
  await prisma.supplier.upsert({
    where: { origin: provider },
    update: { autoSyncEnabled: activado },
    create: {
      origin: provider,
      name: conectorDe(provider)!.nombre,
      autoSyncEnabled: activado,
    },
  });
  revalidatePath("/admin/proveedores");
  return { success: true };
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
  // Lo ya pausado se invalida aunque una tanda posterior tire: el producto
  // quedo inactivo en la base y la ficha cacheada no lo sabe. Los ids viajan
  // adjuntos al error (ver pausadosDeError en lib/sync-run.ts).
  let pausadosIds: string[] = [];
  try {
    const r = await pausarAusentesDeCorrida(runId, admin.email);
    pausadosIds = r.pausadosIds;
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
    pausadosIds = pausadosDeError(error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "No se pudo pausar.",
    };
  } finally {
    invalidarCachePublico(tagsPorProductos(pausadosIds));
    // pausar() deja la marca de invalidacion pendiente: el barrido la limpia.
    await barrerSinFallar("proveedores");
  }
}

/// "Pausar sin confirmación del proveedor": pausa ausentes que NO se pueden
/// verificar, con una persona asumiendo la decision. Mismo permiso que
/// "Pausar estos N" (cualquier admin): es reversible, y el sync lo reactiva
/// si el producto vuelve al listado. Separado a proposito de aquel boton,
/// que solo pausa lo que el proveedor confirma — ver pausarSinConfirmacion
/// en lib/sync-run.ts, que ademas rechaza cualquier id que no este en la
/// lista de "no se pueden verificar".
export async function pausarSinConfirmacion(
  provider: ProductOrigin,
  externalIds: string[]
): Promise<{ success: boolean; error?: string; pausados?: number }> {
  // Gate propio: una Server Action es un endpoint, se puede invocar sin
  // pasar por la pantalla.
  const admin = await requireAdmin();
  // Una sola transaccion en la lib: si tira, no se pauso nada. El finally
  // cubre el caso de que algo tire DESPUES de pausar (revalidatePath).
  let productIds: string[] = [];
  try {
    const r = await pausarSinConfirmacionDeLib(provider, externalIds, admin.email);
    productIds = r.productIds;
    revalidatePath("/admin/proveedores");
    revalidatePath("/catalogo");
    revalidatePath("/");
    return { success: true, pausados: r.pausados.length };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "No se pudo pausar.",
    };
  } finally {
    invalidarCachePublico(tagsPorProductos(productIds));
    await barrerSinFallar("proveedores");
  }
}

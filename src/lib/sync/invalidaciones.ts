import { prisma } from "@/lib/prisma";
import { invalidarCachePublico, TAG, tagsPorProductos } from "@/lib/cache-tags";

/// Barrido de invalidaciones pendientes de la cache publica.
///
/// El conector marca `Product.invalidacionPendienteDesde` en la MISMA
/// transaccion que escribe un cambio que el cliente nota (cambio publico,
/// stock que cruza el cero, pausa). Este barrido —que corre en cada
/// invocacion del cron del sync y en cada tick del panel, sea cual sea su
/// resultado— lee las marcas, pide la invalidacion y recien DESPUES las limpia.
///
/// ORDEN: marca (con el commit) -> invalidar -> limpiar. Una muerte entre el
/// commit y la invalidacion, o entre la invalidacion y la limpieza, deja la
/// marca en pie y la proxima invocacion reintenta (al menos una vez; invalidar
/// de mas es barato).
///
/// VENTANA RESIDUAL, dicha sin adornos: `revalidateTag` solo ENCOLA. El pedido
/// real a la plataforma corre al final del request. Si la invocacion muere
/// DESPUES de que limpiamos la marca pero ANTES de que ese pedido se ejecute
/// (o si la plataforma lo rechaza, por ejemplo un 429), el cambio queda sin
/// invalidar y sin marca: la ficha se pone al dia por TTL (hasta 24 h) o con
/// "Refrescar tienda". Es una ventana de milisegundos, pero existe: desde el
/// proceso no hay forma de saber que el pedido encolado se cumplio.

/// Por encima de esto se invalida `store` en vez de un tag por producto:
/// la primera corrida tras desplegar marca ~todo el catalogo (hash nulo), y
/// ~1.000 revalidaciones juntas pegan contra el limite por segundo de la
/// plataforma. Tirar toda la cache de una vez es un solo pedido y equivale.
export const MAX_TAGS_POR_BARRIDO = 200;

/// Productos por UPDATE al limpiar: el WHERE lleva un OR por producto.
const LOTE_LIMPIEZA = 200;

export interface MarcaPendiente {
  id: string;
  invalidacionPendienteDesde: Date | null;
}

/// Limpia SOLO las marcas de `pendientes` y solo si siguen siendo las que se
/// leyeron (compare-and-set sobre la fecha): si un tick renovo la marca de un
/// producto entre la lectura y ahora (otro cambio posterior), esa marca nueva
/// queda en pie. Los productos marcados despues de la lectura ni se tocan.
export async function limpiarMarcas(pendientes: MarcaPendiente[]): Promise<void> {
  for (let i = 0; i < pendientes.length; i += LOTE_LIMPIEZA) {
    await prisma.product.updateMany({
      where: {
        OR: pendientes.slice(i, i + LOTE_LIMPIEZA).map((p) => ({
          id: p.id,
          invalidacionPendienteDesde: p.invalidacionPendienteDesde,
        })),
      },
      data: { invalidacionPendienteDesde: null },
    });
  }
}

export async function barrerInvalidacionesPendientes(
  maxTags = MAX_TAGS_POR_BARRIDO
): Promise<{ ids: string[] }> {
  const pendientes = await prisma.product.findMany({
    where: { invalidacionPendienteDesde: { not: null } },
    select: { id: true, invalidacionPendienteDesde: true },
  });
  if (pendientes.length === 0) return { ids: [] };

  const ids = pendientes.map((p) => p.id);
  invalidarCachePublico(ids.length > maxTags ? [TAG.store] : tagsPorProductos(ids));
  await limpiarMarcas(pendientes);
  return { ids };
}

/// Igual que el barrido, pero nunca tira: un fallo aca no puede tapar el
/// resultado del tick que lo llamo. Las marcas quedan y se reintenta en la
/// proxima invocacion.
export async function barrerSinFallar(contexto: string): Promise<void> {
  try {
    await barrerInvalidacionesPendientes();
  } catch (error) {
    console.error(`[${contexto}] No se pudieron barrer las invalidaciones pendientes:`, error);
  }
}

/// Borra las marcas ANTERIORES O IGUALES a `hasta`. Lo usa «Refrescar tienda»:
/// quien llama toma `hasta = new Date()` ANTES de invalidar `store`, asi una
/// marca escrita despues del pedido (un tick concurrente) no se borra: esa
/// todavia no estaba cubierta por la invalidacion.
export async function limpiarTodasLasMarcas(hasta: Date): Promise<number> {
  const r = await prisma.product.updateMany({
    where: { invalidacionPendienteDesde: { lte: hasta } },
    data: { invalidacionPendienteDesde: null },
  });
  return r.count;
}

/// Pedido mayor al stock, visto desde una cotizacion.
///
/// DECISION DE LOS DUENOS (2026-11-04): la tienda LIMITA la cantidad al stock
/// disponible, como hace Zecat — no se promete lo que no se puede entregar
/// (revierte la regla anterior de "no se recorta al stock"). El tope vive en
/// la ficha (purchase-panel), no en el servidor: submitQuote sigue sin
/// rechazar nada, porque esto es una cotizacion, no una venta.
///
/// La marca de este archivo es la RED DE SEGURIDAD de ese tope, solo para
/// Ganchito (mail y panel): un carrito guardado ayer puede superar el stock
/// de hoy despues de un sync, y el servidor lo acepta igual. El cliente no ve
/// nada nuevo.
///
/// Modulo puro, sin acceso a datos: quien lo llama pasa el stock DISPONIBLE
/// de cada sku (stock - reservedStock, ver getVariantAvailableStock), asi el
/// mismo criterio sirve en el server action (al armar el mail) y en el panel
/// (en vivo, contra el stock de hoy).

/// Texto de la marca. Compartido entre el mail y el panel.
export function textoPedidoMayorAlStock(disponible: number): string {
  return `Pedido mayor al stock del último sync (stock: ${disponible})`;
}

/// Para cada linea, el stock disponible de su sku SI el pedido lo supera; null
/// si no (o si no hay dato: sin sku, o un sku que no figura en el mapa).
///
/// Se suma por SKU antes de comparar: dos lineas del mismo sku piden, en
/// conjunto, esa cantidad de la misma variante. Devuelve un array paralelo a
/// `lineas`, mismo orden.
///
/// Con stock 0 y pedido > 0 se marca igual (devuelve 0): para Ganchito es la
/// marca mas util.
export function lineasSobreElStock(
  lineas: Array<{ variantSku: string | null; quantity: number }>,
  disponiblePorSku: Map<string, number>
): Array<number | null> {
  const pedidoPorSku = new Map<string, number>();
  for (const l of lineas) {
    if (!l.variantSku) continue;
    pedidoPorSku.set(l.variantSku, (pedidoPorSku.get(l.variantSku) ?? 0) + l.quantity);
  }
  return lineas.map((l) => {
    if (!l.variantSku) return null;
    const disponible = disponiblePorSku.get(l.variantSku);
    if (disponible === undefined) return null;
    return (pedidoPorSku.get(l.variantSku) ?? 0) > disponible ? disponible : null;
  });
}

/// Cuanto mas se puede sumar de una variante: stock disponible menos lo que ya
/// esta pedido de ese mismo sku (carrito guardado + lineas del borrador). Nunca
/// negativo: un carrito viejo que ya supera el stock da 0, no un numero menor.
export function cantidadRestante(disponible: number, yaPedido: number): number {
  return Math.max(0, disponible - yaPedido);
}

/// Estados en los que la cotizacion ya esta cerrada: aceptada, rechazada o
/// vencida. Ahi la marca de stock EN VIVO del panel no dice nada util (el
/// stock de hoy no cambia lo que se acepto o se perdio), asi que se oculta.
/// DRAFT, SUBMITTED y QUOTED siguen abiertas: todavia se esta armando el
/// presupuesto, y que el sync reponga o no importa.
const ESTADOS_CERRADOS: readonly string[] = ["ACCEPTED", "REJECTED", "EXPIRED"];

export function esCotizacionCerrada(status: string): boolean {
  return ESTADOS_CERRADOS.includes(status);
}

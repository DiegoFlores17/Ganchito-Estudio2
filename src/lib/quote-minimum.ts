/// Minimo de compra del proveedor, visto desde una cotizacion YA guardada.
///
/// El minimo es por PRODUCTO, no por linea: si el mismo producto tiene
/// varias lineas (distintos color/talle), se suman todas antes de comparar.
/// Es el mismo criterio de /cotizar (belowMinimum en page.tsx) y del panel de
/// compra; si se cambia uno, hay que cambiar los tres.
///
/// El minimo sale del snapshot que cada QuoteItem congela al cotizar
/// (`minOrderQuantity`), no del producto actual: si el proveedor lo cambia
/// despues, la cotizacion sigue mostrando lo que valia cuando se armo.
/// Snapshot null (cotizaciones anteriores a la columna) o 0: sin marca.
///
/// Es un aviso SOLO para Ganchito (mail y panel). No se muestra al cliente
/// ni va en el mensaje de WhatsApp, y no bloquea nada: es una cotizacion, no
/// una venta.
export function productosBajoMinimo(
  items: Array<{
    productId: string;
    quantity: number;
    minOrderQuantity: number | null;
  }>
): Map<string, number> {
  const totales = new Map<string, { total: number; min: number }>();
  for (const item of items) {
    if (!item.minOrderQuantity) continue;
    const entry = totales.get(item.productId) ?? {
      total: 0,
      min: item.minOrderQuantity,
    };
    entry.total += item.quantity;
    totales.set(item.productId, entry);
  }
  const bajo = new Map<string, number>();
  for (const [productId, { total, min }] of totales) {
    if (total < min) bajo.set(productId, min);
  }
  return bajo;
}

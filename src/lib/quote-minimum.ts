/// Umbral de personalizacion sin recargo del proveedor, visto desde una
/// cotizacion YA guardada.
///
/// OJO con el nombre historico del archivo y de la columna: `minOrderQuantity`
/// (`minimum_application_quantity` de Zecat) NO es un minimo de compra. En la
/// tienda de Zecat el Gorro Cap 031 (min 119) se compra desde 1 unidad con el
/// boton habilitado, y el 119 se muestra como "Personalizacion sin recargos
/// desde 119 un.". Es el umbral por debajo del cual el proveedor cobra un
/// recargo por personalizar (ver `customization_under_minimum_extra_cost`).
/// Verificado contra la tienda de Zecat el 2026-11-04.
///
/// PRINCIPIO (2026-11-04, decision de los duenos): este umbral es una
/// condicion comercial del proveedor hacia Ganchito, NO informacion para el
/// cliente. Se usa SOLO para marcas internas (mail de aviso y detalle del
/// panel) y NUNCA se muestra en la tienda publica: ni en la ficha, ni en
/// /cotizar, ni en el mensaje de WhatsApp. Tampoco viaja en el payload que
/// llega al navegador (ni como prop de la ficha ni en el resumen de
/// /cotizar). Mismo criterio que el porcentaje de descuento por cantidad. Si
/// alguna vez parece buena idea mostrarlo, esta nota es para frenar ahi.
///
/// El umbral es por PRODUCTO, no por linea: si el mismo producto tiene
/// varias lineas (distintos color/talle), se suman todas antes de comparar.
///
/// El valor sale del snapshot que cada QuoteItem congela al cotizar
/// (`minOrderQuantity`), no del producto actual: si el proveedor lo cambia
/// despues, la cotizacion sigue mostrando lo que valia cuando se armo.
/// Snapshot null (cotizaciones anteriores a la columna) o 0: sin marca.
///
/// No bloquea nada: es una cotizacion, no una venta.

/// Texto de la marca interna. Compartido entre el mail y el panel.
export function textoRecargoProveedor(sinRecargoDesde: number): string {
  return `Personalización con recargo del proveedor (sin recargo desde ${sinRecargoDesde} un.)`;
}

/// Nota interna para un producto debajo del umbral que se cotizo SIN
/// personalizacion: no hay recargo que cobrar, pero si el cliente despues
/// quiere personalizarlo, lo lleva. No afirma una personalizacion que no hay.
export function textoBajoUmbralSinPersonalizar(sinRecargoDesde: number): string {
  return `Bajo el umbral del proveedor: si se personaliza, lleva recargo (sin recargo desde ${sinRecargoDesde} un.)`;
}

/// La marca que corresponde a un producto debajo del umbral, segun haya
/// quedado con personalizacion o sin ella.
export function textoUmbral(sinRecargoDesde: number, conPersonalizacion: boolean): string {
  return conPersonalizacion
    ? textoRecargoProveedor(sinRecargoDesde)
    : textoBajoUmbralSinPersonalizar(sinRecargoDesde);
}

/// Productos de la cotizacion cuyo total queda debajo del umbral sin recargo.
/// Devuelve productId -> umbral.
export function productosConRecargo(
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

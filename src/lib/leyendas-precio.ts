// Leyendas que acompanan al precio: dicen que se cotiza aparte. El precio calculado
// es el del producto "pelado"; la personalizacion y el envio se suman en el
// presupuesto final. Todos los textos viven aca para que, cuando se carguen
// los precios de impresion de Zecat, la leyenda de esos productos se cambie
// en UN solo lugar (la rama `personalizable` de `leyendasDePrecio`).
//
// Es un modulo puro, sin imports: lo pueden usar server y client components.

export const LEYENDAS_PRECIO = {
  /// Linea debajo del precio en la card del catalogo.
  card: {
    personalizable: "Personalización y envío se cotizan aparte",
    sinPersonalizacion: "Se entrega sin personalizar · el envío se cotiza aparte",
  },
  /// Texto junto al precio en la ficha del producto (tras el "+ IVA").
  ficha: {
    personalizable: "La personalización y el envío se cotizan aparte.",
    sinPersonalizacion: "Producto que se entrega sin personalizar. El envío se cotiza aparte.",
  },
  /// Aclaracion del total en /cotizar, sin ninguna personalizacion elegida.
  totalCotizar:
    "Total estimado + IVA. La personalización y el envío se cotizan aparte y van en el presupuesto final.",
  /// Idem, con la personalizacion estimada de TODOS los productos incluida.
  totalCotizarConImpresion:
    "Total estimado + IVA, con personalización estimada · el envío se cotiza aparte y va en el presupuesto final.",
  /// Idem, cuando lo unico sin personalizacion son productos que el cliente
  /// eligio "Sin personalizar" (o que no se personalizan): no hay nada de
  /// personalizacion que cotizar aparte, solo el envio.
  totalCotizarSoloEnvio:
    "Total estimado + IVA. El envío se cotiza aparte y va en el presupuesto final.",
  /// Idem, con personalizacion estimada solo en algunos productos.
  totalCotizarImpresionParcial:
    "Total estimado + IVA, con la personalización estimada de los productos que la tienen elegida. El resto de la personalización y el envío se cotizan aparte y van en el presupuesto final.",
  /// Sufijo de la linea de total en el email y el mensaje de WhatsApp.
  totalMensaje: "(+ personalización y envío)",
  totalMensajeConImpresion: "(con personalización estimada · envío aparte)",
  totalMensajeSoloEnvio: "(+ envío)",
  totalMensajeImpresionParcial:
    "(con personalización estimada en parte · el resto y el envío aparte)",
  /// Linea del recargo del proveedor por personalizar pocas unidades, en
  /// /cotizar y en el total que ve el cliente. Sin el umbral (es una
  /// condicion comercial del proveedor, ver lib/quote-minimum.ts) y sin
  /// prometer que con mas unidades la personalizacion sea gratis.
  adicionalCantidadChica: "Adicional del proveedor por cantidad chica",
  /// Cierre de la seccion de personalizacion de la ficha.
  impresion:
    "El logo se carga en el paso de cotización; el costo de la personalización va en el presupuesto final.",
} as const;

/// Que dice la leyenda del total, segun los productos del pedido:
/// - `conImpresion`: con una personalizacion elegida (precio estimado).
/// - `sinPrecio`: personalizables cuya personalizacion NO tiene precio en la
///   tienda (CDO, o Zecat sin niveles). Esa personalizacion se cotiza aparte.
/// Los que el cliente eligio "Sin personalizar" y los que no se personalizan
/// no cuentan: no hay personalizacion que cotizar aparte.
export type ImpresionEnTotal = "ninguna" | "toda" | "parcial" | "soloEnvio";

export function impresionEnTotal({
  conImpresion,
  sinPrecio,
}: {
  conImpresion: number;
  sinPrecio: number;
}): ImpresionEnTotal {
  if (sinPrecio > 0) return conImpresion > 0 ? "parcial" : "ninguna";
  return conImpresion > 0 ? "toda" : "soloEnvio";
}

/// Aclaracion del total en /cotizar.
export function leyendaTotalCotizar(impresion: ImpresionEnTotal): string {
  if (impresion === "toda") return LEYENDAS_PRECIO.totalCotizarConImpresion;
  if (impresion === "parcial") return LEYENDAS_PRECIO.totalCotizarImpresionParcial;
  if (impresion === "soloEnvio") return LEYENDAS_PRECIO.totalCotizarSoloEnvio;
  return LEYENDAS_PRECIO.totalCotizar;
}

/// Sufijo del total en el email y el mensaje de WhatsApp.
export function leyendaTotalMensaje(impresion: ImpresionEnTotal): string {
  if (impresion === "toda") return LEYENDAS_PRECIO.totalMensajeConImpresion;
  if (impresion === "parcial") return LEYENDAS_PRECIO.totalMensajeImpresionParcial;
  if (impresion === "soloEnvio") return LEYENDAS_PRECIO.totalMensajeSoloEnvio;
  return LEYENDAS_PRECIO.totalMensaje;
}

/// Un producto es personalizable si tiene al menos una tecnica de impresion
/// (`ProductPrintingType`). El llamador resuelve ese booleano.
export function leyendasDePrecio({ personalizable }: { personalizable: boolean }) {
  return {
    card: personalizable
      ? LEYENDAS_PRECIO.card.personalizable
      : LEYENDAS_PRECIO.card.sinPersonalizacion,
    ficha: personalizable
      ? LEYENDAS_PRECIO.ficha.personalizable
      : LEYENDAS_PRECIO.ficha.sinPersonalizacion,
    totalCotizar: LEYENDAS_PRECIO.totalCotizar,
    totalMensaje: LEYENDAS_PRECIO.totalMensaje,
  };
}

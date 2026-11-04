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
  /// Aclaracion del total en /cotizar.
  totalCotizar:
    "Total estimado + IVA. La personalización y el envío se cotizan aparte y van en el presupuesto final.",
  /// Sufijo de la linea de total en el email y el mensaje de WhatsApp.
  totalMensaje: "(+ personalización y envío)",
  /// Cierre de la seccion de personalizacion de la ficha.
  impresion:
    "El logo se carga en el paso de cotización; el costo de la personalización va en el presupuesto final.",
} as const;

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

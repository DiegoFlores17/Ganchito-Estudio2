// Tipos de la respuesta de la API de Zecat (API 2.0).
// Solo modelamos los campos que realmente consumimos en el conector,
// no toda la superficie de la API (ver el PDF de integración para el resto).

export interface ZecatFamily {
  id: string | number;
  /// El nombre de la familia viene en "description", no en "name".
  description: string;
  icon_url?: string | null;
  /// Ej: "/bolsos-y-mochilas-corporativas". Se usa como base del slug.
  url?: string | null;
}

export interface ZecatDimensions {
  height?: number | null;
  width?: number | null;
  length?: number | null;
  weight?: number | null;
}

export interface ZecatImage {
  image_url?: string | null;
  /// Las imágenes dentro de una variante usan esta otra casing.
  imageUrl?: string | null;
  main?: boolean;
}

export interface ZecatAttributeLabel {
  description?: string | null;
}

export interface ZecatVariantRecord {
  sku: string;
  elementDescription1?: string | null;
  elementDescription2?: string | null;
  elementDescription3?: string | null;
  /// Dicen QUE es cada elementDescriptionN para este producto puntual
  /// (ej: "Talle", "Color", "Telas"). La posición NO tiene un significado
  /// fijo entre productos: hay que leer esto para saber que es cada una.
  attribute_one?: ZecatAttributeLabel | null;
  attribute_two?: ZecatAttributeLabel | null;
  attribute_three?: ZecatAttributeLabel | null;
  /// La API los devuelve como string (ej: "2133"), no como number.
  stock?: string | number | null;
  reservedStock?: string | number | null;
  active?: boolean;
  images?: ZecatImage[];
  /// Descuento de partner en PORCENTAJE (ej: 30). El costo real es
  /// price x (1 - discount_partner/100) — `price` a secas es el precio
  /// sugerido de venta al PUBLICO, no el costo. Ver extractCostPrice().
  ///
  /// Verificado que este numero ES el descuento de nivel producto ya
  /// aplicado: los productos con "SALE SEASON" (40%) traen 40, los de
  /// "32.5 apparel" traen 32,5, y los que no tienen descuento de producto
  /// traen el 30 base. Por eso ese descuento NO se vuelve a aplicar encima.
  discount_partner?: number | string | null;
  /// SEGUNDA capa: el descuento de RANGO asignado a ESTA variante. Solo
  /// viene completo por la rama `variants.colors` / `variants.sizes`; el
  /// array plano `products[]` trae unicamente el puntero
  /// { hasRangeDiscount, discountId }, sin los tramos.
  discountRangeProduct?: ZecatDiscountRangeProduct[] | null;
}

/// Fila que liga una variante con UN tramo de un descuento de rango. Una
/// variante trae varias (una por tramo), todas del mismo `discount`.
export interface ZecatDiscountRangeProduct {
  discountRange?: ZecatDiscountRange | null;
}

export interface ZecatDiscountRange {
  discountId?: string | number | null;
  /// Porcentaje del tramo (ej: 37.83). Siempre entre 0 y 100: verificado
  /// sobre los 3.371 tramos del catalogo, ninguno negativo ni >= 100.
  discountPercentage?: number | string | null;
  minQuantity?: number | string | null;
  /// null cuando el tramo es el ultimo (con `withOutLimit: true`).
  maxQuantity?: number | string | null;
  discount?: ZecatDiscount | null;
}

export interface ZecatDiscount {
  id?: string | number | null;
  /// El nombre es lo que hace auditable el descuento: dice a que aplica
  /// ("Regent blanca Xs a 2Xl"), cosa que el id suelto no.
  name?: string | null;
  enabled?: boolean | null;
  /// true en los descuentos de RANGO: se acumulan sobre discount_partner.
  /// Los de nivel producto (SALE SEASON, Liquidacion) lo traen en false y
  /// ya vienen incluidos en discount_partner.
  isCumulative?: boolean | null;
}

export interface ZecatVariantGroup {
  colors?: Record<string, ZecatVariantRecord[]>;
  sizes?: Record<string, ZecatVariantRecord[]>;
}

export interface ZecatPrintingArea {
  id: string | number;
  name: string;
  height_centimeters?: number | null;
  width_centimeters?: number | null;
}

/// Una fila de `printing_types`: un NIVEL de precio de personalizacion (ver
/// ProductPrintingLevel en el schema). Solo los campos que consumimos: el
/// payload trae muchos mas (tiempos, wepod, laser_color...).
export interface ZecatPrintingType {
  id: string | number;
  /// La tecnica visible ("Bordado"); varios niveles comparten el mismo name.
  name: string;
  /// El nivel ("Bordado 2KP"). Suele traer espacios al final.
  description?: string | null;
  /// COSTO de partner, en pesos (aunque el producto diga USD). Verificado al
  /// centavo contra el backoffice. NO confundir con `unit_price_wepod`, que
  /// es de otro canal y se descarta.
  unit_price?: number | string | null;
  /// Costo de preparacion (una vez), en pesos.
  setup_price?: number | string | null;
  /// Area del nivel en cm2.
  area?: number | string | null;
  /// Si vienen en true, el nivel no cobra el primer logo / la preparacion: no
  /// sabemos modelarlo, asi que el set se considera roto (ver impresion.ts).
  first_logo_free?: boolean | null;
  setup_free?: boolean | null;
  configuration?: {
    printing_area_printing_types?: Array<{ printing_area_id?: string | number | null }> | null;
  } | null;
}

export interface ZecatGenericProduct {
  id: string | number;
  external_id?: string | null;
  name: string;
  description: string;
  /// Umbral LOGISTICO del proveedor (reposicion/importacion), NO un minimo
  /// de venta: Zecat vende desde 1 unidad aunque esto diga 4786. Se guarda
  /// en Product.supplierMinOrderQuantity solo como referencia.
  minimum_order_quantity?: number | null;
  /// NO es un minimo de compra: es el umbral desde el cual la personalizacion
  /// va SIN recargo del proveedor (relacionado con
  /// `customization_under_minimum_extra_cost`). En la tienda de Zecat el Gorro
  /// Cap 031 (119) se compra desde 1 unidad y el 119 se muestra como
  /// "Personalizacion sin recargos desde 119 un." (verificado 2026-11-04).
  minimum_application_quantity?: number | null;
  /// Recargo de personalizacion cuando se pide menos que
  /// `minimum_application_quantity`. Por producto, en pesos.
  customization_under_minimum_extra_cost?: number | string | null;
  currency?: "ARS" | "USD" | string;
  published?: boolean;

  // Campos de precio reales (confirmados contra la API en vivo, no la doc):
  // price/unit_price vienen acompañados de minimum/maximum/suggested_profit_percentage,
  // y total_price/total_taxes/total_with_taxes son una tríada consistente
  // (total_price * (1 + tax/100) = total_with_taxes). Todavía no está
  // confirmado cuál de los dos grupos es el costo puro sin margen — ver
  // extractCostPrice() en normalize.ts, es el único lugar que lo decide.
  price?: number | string | null;
  unit_price?: number | string | null;
  total_price?: number | string | null;
  total_taxes?: number | string | null;
  total_with_taxes?: number | string | null;
  tax?: number | null;
  minimum_profit_percentage?: number | null;
  maximum_profit_percentage?: number | null;
  suggested_profit_percentage?: number | null;

  dimensions?: ZecatDimensions;
  families?: ZecatFamily[];
  variants?: ZecatVariantGroup;
  images?: ZecatImage[];
  printing_areas?: ZecatPrintingArea[];
  printing_types?: ZecatPrintingType[];
}

export interface ZecatGenericProductListResponse {
  total_pages: number;
  count: number;
  generic_products: ZecatGenericProduct[];
}

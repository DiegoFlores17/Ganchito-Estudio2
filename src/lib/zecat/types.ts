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

export interface ZecatPrintingType {
  id: string | number;
  name: string;
}

export interface ZecatGenericProduct {
  id: string | number;
  external_id?: string | null;
  name: string;
  description: string;
  minimum_order_quantity?: number | null;
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

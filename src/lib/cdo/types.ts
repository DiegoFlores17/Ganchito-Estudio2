/// Tipos de la API de CDO Promocionales / Stocksur (v2 Argentina).
///
/// Escritos a partir de la exploracion del entorno de pruebas, no de la doc:
/// la documentacion oficial solo lista los dos endpoints y deja las tablas de
/// parametros vacias. Ver el comentario de client.ts.

export interface CdoPicture {
  small?: string | null;
  medium?: string | null;
  original?: string | null;
}

export interface CdoOtherPicture extends CdoPicture {
  index?: number;
}

export interface CdoColor {
  id: number;
  name: string | null;
  hex_code: string | null;
  picture: string | null;
}

export interface CdoVariant {
  id: number;
  /// OJO: viene vacio en varios casos (13 de 411 en pruebas). No sirve como
  /// clave sin un fallback — ver buildSku() en normalize.ts.
  sku: string;
  novedad?: boolean;
  /// Stock LIBRE, ya neto. No es el par stock/reservedStock de Zecat.
  stock_available: number | null;
  /// Stock TOTAL. Viene null en algunos casos (12 de 411 en pruebas).
  stock_existent: number | null;
  /// Precio de lista y precio neto, ambos EN DOLARES y como string.
  /// net_price <= list_price siempre (verificado sobre las 411 variantes).
  list_price: string | null;
  net_price: string | null;
  color?: CdoColor | null;
  picture?: CdoPicture | null;
  detail_picture?: CdoPicture | null;
  other_pictures?: CdoOtherPicture[] | null;
}

export interface CdoCategory {
  id: number;
  name: string;
}

/// Un "icono" de CDO mezcla dos cosas distintas: tecnicas de impresion
/// (Serigrafia, Bordado) y atributos del producto (RECICLABLE, BPA FREE).
/// La separacion se hace por id en normalize.ts.
export interface CdoIcon {
  id: number;
  /// El nombre legible esta en `label`, NO en `name` (que no existe).
  label: string | null;
  short_name: string | null;
  picture: string | null;
}

/// Medidas del EMBALAJE, no del producto. Viene null en 160 de 207 productos,
/// y varios de los que llegan tienen todos los campos internos en null.
/// No se mapea a las dimensiones del producto a proposito.
export interface CdoPacking {
  width: number | null;
  height: number | null;
  depth: number | null;
  volume: number | null;
  quantity: number | null;
  weight: number | null;
}

export interface CdoProduct {
  id: number;
  /// Codigo comercial. NO usar como clave: hay uno cuyo valor es literalmente
  /// "25% de descuento!!!!!".
  code: string;
  name: string;
  description: string | null;
  categories?: CdoCategory[] | null;
  icons?: CdoIcon[] | null;
  packing?: CdoPacking | null;
  variants?: CdoVariant[] | null;
}

export interface CdoPagination {
  current_page: number;
  prev_page: number | null;
  next_page: number | null;
  total_pages: number;
  total_count: number;
}

export interface CdoProductListResponse {
  products: CdoProduct[];
  meta: { pagination: CdoPagination };
}

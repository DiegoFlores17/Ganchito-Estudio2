import type {
  ZecatAttributeLabel,
  ZecatFamily,
  ZecatGenericProduct,
  ZecatVariantGroup,
  ZecatVariantRecord,
} from "./types";

/// Error propio para que el sync distinga "no se pudo calcular el costo"
/// de cualquier otra falla: ante este error el producto NO se importa y,
/// si ya existia con el precio viejo inflado, se PAUSA.
export class ZecatPricingError extends Error {}

/// ÚNICO lugar que decide el "costo puro". CORREGIDO el 2026-08-31 contra
/// la doc oficial de la API 2.0 y la respuesta real del Bolso Championship
/// (5515): `price`/`unit_price` es el PRECIO SUGERIDO DE VENTA AL PUBLICO
/// (= final_consumer_price_wepod, el nombre lo confiesa). El costo real de
/// partner es price x (1 - discount_partner/100), con `discount_partner`
/// en PORCENTAJE a nivel VARIANTE. Verificado al centavo:
/// 37311.99 x (1 - 30/100) = 26118.39 = el costo del backoffice de Zecat.
///
/// La validacion anterior ("price x 1.20 coincide con la web de Ganchito")
/// comparaba contra un PRECIO DE VENTA de la web vieja — probaba que price
/// es un precio de venta, o sea exactamente lo contrario de lo que
/// concluimos. El margen del 45% aplicado sobre price cobraba un 43% de mas.
///
/// SIN fallback a proposito: si discount_partner no viene o no es valido,
/// se tira ZecatPricingError y el producto no se importa. Caer a `price`
/// seria guardar el precio inflado en silencio — un producto faltante y
/// visible en el log es preferible a uno con precio que nadie detecta.
///
/// NO usar total_price: es el costo del tramo MAS PROFUNDO de la escala de
/// volumen (2700+ unidades) — cobraria de menos en pedidos chicos.
///
/// Esto devuelve la PRIMERA capa. La segunda (los descuentos de rango por
/// variante) sale de extractRangeDiscount() y se aplica al LEER, no acá.
export function extractCostPrice(
  product: ZecatGenericProduct,
  variant: ZecatVariantRecord
): number {
  const rawPrice = product.price ?? product.unit_price;
  const publicPrice =
    typeof rawPrice === "number" ? rawPrice : parseFloat(String(rawPrice));
  if (Number.isNaN(publicPrice) || publicPrice <= 0) {
    throw new ZecatPricingError(
      `Producto ${product.id}: price/unit_price invalido (${JSON.stringify(rawPrice)}).`
    );
  }

  const rawDiscount = variant.discount_partner;
  const discount =
    typeof rawDiscount === "number"
      ? rawDiscount
      : parseFloat(String(rawDiscount));
  // 0 y 100 tambien son invalidos: 0 dejaria el precio publico como costo
  // (el bug exacto que estamos corrigiendo) y 100 daria costo cero.
  if (Number.isNaN(discount) || discount <= 0 || discount >= 100) {
    throw new ZecatPricingError(
      `Producto ${product.id}, variante ${variant.sku}: discount_partner invalido (${JSON.stringify(rawDiscount)}). No se importa para no guardar el precio publico como costo.`
    );
  }

  return publicPrice * (1 - discount / 100);
}

/// Un tramo de la escala: desde `min` unidades (hasta `max`, o sin tope) se
/// descuenta `pct` por ciento sobre el costo que ya devolvio extractCostPrice.
export interface RangeDiscountTier {
  min: number;
  max: number | null;
  pct: number;
}

export interface RangeDiscount {
  externalId: string;
  name: string | null;
  /// El porcentaje del tramo que aplica a 2 unidades: el unico que se usa hoy.
  percent: number;
  /// La escala entera, para poder sumar la escalera despues sin re-importar.
  tiers: RangeDiscountTier[];
}

/// La cantidad a partir de la cual hay descuento. En Zecat la escala siempre
/// arranca en 2: comprar 1 unidad paga el costo pelado.
export const RANGE_DISCOUNT_MIN_QUANTITY = 2;

/// SEGUNDA capa de descuento: los rangos asignados a la variante.
///
/// Solo lee `variant.discountRangeProduct`, que viene completo porque
/// flattenVariants toma los records de `variants.colors` / `variants.sizes`.
/// El array plano `products[]` de la respuesta trae unicamente el puntero
/// { hasRangeDiscount, discountId }, sin tramos: si algun dia alguien cambia
/// la fuente de las variantes a `products[]`, esto se queda en null y los
/// precios vuelven silenciosamente a la primera capa.
///
/// NO se usa el campo `price` que la API trae ya calculado en
/// `discountRanges` (nivel producto), aunque seria mas comodo: ese numero se
/// calcula con UN SOLO discount_partner para todo el producto, y hay 11
/// productos cuyas variantes tienen dp distintos entre si (los del descuento
/// "Descuento por color", que apunta a variantes sueltas). Usarlo daria el
/// costo equivocado en 24 variantes: 12 de mas y, peor, 12 de MENOS, o sea
/// cotizando por debajo del costo real. La cuenta propia con el dp de cada
/// variante cierra al centavo en las 1.599.
///
/// A diferencia de extractCostPrice(), esto NO tira ante datos raros: devuelve
/// null y la variante se queda con su costo de primera capa. La asimetria es
/// deliberada — alla el fallback inseguro era cobrar de mas y quedaba
/// invisible; aca no aplicar el descuento cotiza mas caro, que es el lado
/// conservador: nunca por debajo del costo.
export function extractRangeDiscount(
  variant: ZecatVariantRecord
): RangeDiscount | null {
  const filas = variant.discountRangeProduct;
  if (!Array.isArray(filas) || filas.length === 0) return null;

  let externalId: string | null = null;
  let name: string | null = null;
  const tiers: RangeDiscountTier[] = [];

  for (const fila of filas) {
    const rango = fila?.discountRange;
    if (!rango) continue;

    // Un descuento apagado del lado del proveedor no se aplica.
    if (rango.discount?.enabled === false) return null;

    const pct = toNumber(rango.discountPercentage);
    const min = toNumber(rango.minQuantity);
    // maxQuantity viene null en el ultimo tramo (withOutLimit): eso es "sin
    // tope", no un dato faltante.
    const rawMax = rango.maxQuantity;
    const max = rawMax === null || rawMax === undefined ? null : toNumber(rawMax);

    // Un porcentaje fuera de (0, 100) no es un descuento: 0 no hace nada y
    // 100 o mas daria costo cero o negativo. Verificado que los 3.371 tramos
    // del catalogo caen dentro del rango, asi que esto es una guarda contra
    // cambios futuros, no contra los datos de hoy.
    if (pct === null || pct <= 0 || pct >= 100) continue;
    if (min === null || min < 1) continue;
    if (max !== null && (max === null || max < min)) continue;

    tiers.push({ min, max, pct });

    const id = rango.discountId ?? rango.discount?.id;
    if (externalId === null && id !== null && id !== undefined) {
      externalId = String(id);
    }
    if (name === null && rango.discount?.name) name = rango.discount.name;
  }

  if (tiers.length === 0 || externalId === null) return null;
  tiers.sort((a, b) => a.min - b.min);

  // El tramo que le toca a 2 unidades. Se BUSCA en vez de exigir min === 2
  // para no depender de que Zecat siga arrancando la escala ahi.
  const inicial = tiers.find(
    (t) =>
      RANGE_DISCOUNT_MIN_QUANTITY >= t.min &&
      (t.max === null || RANGE_DISCOUNT_MIN_QUANTITY <= t.max)
  );
  if (!inicial) return null;

  return { externalId, name, percent: inicial.pct, tiers };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseStock(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

type AttributeKind = "color" | "size" | "material";

/// Zecat no tiene una posición fija para color/talle/material: el orden
/// cambia segun el producto (en indumentaria element1 suele ser Talle y
/// element2 Color; en mochilas puede ser al reves, con element1 = material
/// tipo "Telas"). Lo que SI es estable es la etiqueta de attribute_X.description,
/// asi que clasificamos por texto en vez de por posicion.
function classifyAttribute(
  label: string | null | undefined
): AttributeKind | null {
  if (!label) return null;
  const normalized = label.trim().toLowerCase();

  if (normalized.includes("color")) return "color";
  if (
    normalized.includes("talle") ||
    normalized.includes("size") ||
    normalized.includes("tamaño") ||
    normalized.includes("tamano")
  )
    return "size";
  if (normalized.includes("tela") || normalized.includes("material"))
    return "material";

  return null;
}

export interface VariantAttributes {
  colorName: string | null;
  sizeName: string | null;
  materialName: string | null;
}

export function mapVariantAttributes(
  variant: ZecatVariantRecord
): VariantAttributes {
  const slots: Array<[ZecatAttributeLabel | null | undefined, string | null | undefined]> = [
    [variant.attribute_one, variant.elementDescription1],
    [variant.attribute_two, variant.elementDescription2],
    [variant.attribute_three, variant.elementDescription3],
  ];

  // Algunos productos tienen mas de un atributo del mismo tipo (ej. "Color"
  // Y "Color 2" en productos bicolor). Se combinan en vez de que el ultimo
  // pise al primero, para no perder informacion.
  const buckets: Record<AttributeKind, string[]> = {
    color: [],
    size: [],
    material: [],
  };

  for (const [attribute, rawValue] of slots) {
    const kind = classifyAttribute(attribute?.description);
    const value = rawValue?.trim() || null;
    if (!kind || !value) continue;
    if (!buckets[kind].includes(value)) buckets[kind].push(value);
  }

  return {
    colorName: buckets.color.length ? buckets.color.join(" / ") : null,
    sizeName: buckets.size.length ? buckets.size.join(" / ") : null,
    materialName: buckets.material.length ? buckets.material.join(" / ") : null,
  };
}

/// La API agrupa las variantes por atributo ("colors" y "sizes"), lo que
/// puede repetir la misma variante en ambos grupos. Las juntamos y
/// dedupeamos por sku, que es la clave real de la variante.
export function flattenVariants(
  group: ZecatVariantGroup | undefined
): ZecatVariantRecord[] {
  if (!group) return [];

  const bySku = new Map<string, ZecatVariantRecord>();
  const groups = [
    ...Object.values(group.colors ?? {}),
    ...Object.values(group.sizes ?? {}),
  ];

  for (const records of groups) {
    for (const record of records) {
      if (record.sku) bySku.set(record.sku, record);
    }
  }

  return [...bySku.values()];
}

export function resolveImageUrl(image: {
  image_url?: string | null;
  imageUrl?: string | null;
}): string | null {
  return image.image_url ?? image.imageUrl ?? null;
}

export function toDecimalOrNull(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : value;
}

export function slugifyFamily(family: ZecatFamily): string {
  if (family.url) return family.url.replace(/^\/+/, "");

  return family.description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

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
/// volumen (2700+ unidades) — cobraria de menos en pedidos chicos. La
/// escala completa (discountRangeProduct, 0.1% a 5.1% adicional) queda
/// anotada en PENDIENTES como mejora; su ganancia maxima es 5.1% y juega a
/// favor ignorarla (se cotiza apenas alto en pedidos enormes).
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

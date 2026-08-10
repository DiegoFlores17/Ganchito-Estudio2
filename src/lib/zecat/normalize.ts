import type {
  ZecatAttributeLabel,
  ZecatFamily,
  ZecatGenericProduct,
  ZecatVariantGroup,
  ZecatVariantRecord,
} from "./types";

/// ÚNICO lugar que decide qué campo de la API es el "costo puro". Confirmado
/// contra la API real: price (= unit_price, siempre iguales) x 1.20 coincide
/// exacto con el precio actual de Ganchito para un producto sin oferta
/// (Mochila Space Max). NO usar total_price/total_with_taxes ni aplicar
/// ningún margen acá: el conector solo guarda el costo crudo, el margen se
/// calcula aparte con PricingConfig.defaultMarginPercent.
export function extractCostPrice(product: ZecatGenericProduct): number {
  const raw = product.price ?? product.unit_price;
  const parsed = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (Number.isNaN(parsed)) {
    throw new Error(
      `No se pudo extraer el costo (price/unit_price) del producto ${product.id}: valor recibido = ${JSON.stringify(raw)}`
    );
  }
  return parsed;
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

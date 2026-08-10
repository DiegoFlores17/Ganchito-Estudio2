import type {
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

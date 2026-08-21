import { Currency, ProductOrigin, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchGenericProductDetail, iterateAllGenericProducts } from "./client";
import {
  extractCostPrice,
  flattenVariants,
  mapVariantAttributes,
  parseStock,
  resolveImageUrl,
  slugifyFamily,
  toDecimalOrNull,
} from "./normalize";
import type { ZecatFamily, ZecatGenericProduct, ZecatImage } from "./types";

export interface SyncSummary {
  total: number;
  created: number;
  updated: number;
  failed: number;
  /// Productos donde Zecat mandó currency:"USD". Es un dato sucio conocido
  /// (los valores siguen viniendo en magnitud ARS): no se convierte nada,
  /// solo se loguea para revisar caso por caso.
  usdWarnings: Array<{ zecatId: string | number; name: string }>;
  errors: Array<{ zecatId: string | number; message: string }>;
}

type Tx = Prisma.TransactionClient;

async function resolveCategoryId(
  tx: Tx,
  family: ZecatFamily | undefined
): Promise<string | null> {
  if (!family) return null;

  const category = await tx.category.upsert({
    where: { zecatFamilyId: String(family.id) },
    update: {
      name: family.description,
      iconUrl: family.icon_url ?? null,
    },
    create: {
      zecatFamilyId: String(family.id),
      name: family.description,
      slug: slugifyFamily(family),
      iconUrl: family.icon_url ?? null,
    },
  });

  return category.id;
}

/// Sincroniza un solo producto (detalle completo) contra la base.
/// Devuelve si fue creado o actualizado.
/// Todo el sync de un producto (producto, variantes, imágenes, áreas y
/// tipos de impresión) corre dentro de una única transacción: si algo
/// falla a mitad de camino, no queda el producto con imágenes borradas
/// y sin recrear.
export async function syncProduct(
  detail: ZecatGenericProduct
): Promise<"created" | "updated"> {
  const costPrice = extractCostPrice(detail);
  const variants = flattenVariants(detail.variants);

  return prisma.$transaction(async (tx) => {
    const categoryId = await resolveCategoryId(tx, detail.families?.[0]);

    const productData = {
      origin: ProductOrigin.ZECAT,
      externalId: detail.external_id ?? null,
      name: detail.name,
      description: detail.description,
      costPrice,
      // El campo currency de Zecat no es confiable (ver SyncSummary.usdWarnings):
      // por ahora asumimos ARS siempre y no convertimos nada.
      currency: Currency.ARS,
      minOrderQuantity: detail.minimum_order_quantity ?? null,
      heightCm: toDecimalOrNull(detail.dimensions?.height),
      widthCm: toDecimalOrNull(detail.dimensions?.width),
      lengthCm: toDecimalOrNull(detail.dimensions?.length),
      weightG: toDecimalOrNull(detail.dimensions?.weight),
      active: detail.published ?? true,
      categoryId,
      lastSyncedAt: new Date(),
    };

    const existing = await tx.product.findUnique({
      where: { zecatId: String(detail.id) },
      select: { id: true },
    });

    const product = await tx.product.upsert({
      where: { zecatId: String(detail.id) },
      update: productData,
      create: { zecatId: String(detail.id), ...productData },
    });

    // Variantes: upsert por sku, es la clave real (no duplica en cada corrida).
    for (const variant of variants) {
      const { colorName, sizeName, materialName } =
        mapVariantAttributes(variant);

      await tx.productVariant.upsert({
        where: { sku: variant.sku },
        update: {
          productId: product.id,
          colorName,
          sizeName,
          materialName,
          stock: parseStock(variant.stock),
          reservedStock: parseStock(variant.reservedStock),
          active: variant.active ?? true,
          // Zecat tiene un unico costo por producto, asi que se repite en
          // todas sus variantes. No es redundancia: el costo vive en la
          // variante porque otros proveedores SI difieren entre variantes
          // (ver el comentario de ProductVariant.costPrice en el schema).
          costPrice,
        },
        create: {
          productId: product.id,
          sku: variant.sku,
          colorName,
          sizeName,
          materialName,
          stock: parseStock(variant.stock),
          reservedStock: parseStock(variant.reservedStock),
          active: variant.active ?? true,
          costPrice,
        },
      });
    }

    // Imágenes, áreas y tipos de impresión no tienen una clave estable en
    // nuestro schema: se borran (scoped a este producto) y se recrean,
    // todo dentro de la misma transacción que el upsert de arriba.
    await tx.productImage.deleteMany({ where: { productId: product.id } });
    await tx.printingArea.deleteMany({ where: { productId: product.id } });
    await tx.productPrintingType.deleteMany({
      where: { productId: product.id },
    });

    const dbVariants = await tx.productVariant.findMany({
      where: { productId: product.id },
      select: { id: true, sku: true },
    });
    const variantIdBySku = new Map(dbVariants.map((v) => [v.sku, v.id]));

    const productImages = (detail.images ?? [])
      .map((image, index) => toImageCreateInput(image, index, product.id, null))
      .filter((image): image is NonNullable<typeof image> => image !== null);

    const variantImages = variants.flatMap((variant) =>
      (variant.images ?? [])
        .map((image, index) =>
          toImageCreateInput(
            image,
            index,
            product.id,
            variantIdBySku.get(variant.sku) ?? null
          )
        )
        .filter((image): image is NonNullable<typeof image> => image !== null)
    );

    if (productImages.length || variantImages.length) {
      await tx.productImage.createMany({
        data: [...productImages, ...variantImages],
      });
    }

    if (detail.printing_areas?.length) {
      await tx.printingArea.createMany({
        data: detail.printing_areas.map((area) => ({
          productId: product.id,
          zecatAreaId: String(area.id),
          name: area.name,
          heightCm: toDecimalOrNull(area.height_centimeters),
          widthCm: toDecimalOrNull(area.width_centimeters),
        })),
      });
    }

    if (detail.printing_types?.length) {
      // Zecat trae un registro POR NIVEL DE PRECIO interno (ej: "Bordado
      // 20KP" y "Bordado 22KP" son ids distintos con distinto costo/setup),
      // pero todos comparten el mismo name visible ("Bordado"). Nosotros
      // solo mostramos que TECNICA admite el producto (sin precios, ver
      // PrintingInfo), asi que se deduplica por nombre — si no, un producto
      // con 3 niveles de "Bordado" mostraba "Bordado" repetido 3 veces.
      const uniquePrintingTypes = new Map(
        detail.printing_types.map((type) => [type.name, type])
      );
      await tx.productPrintingType.createMany({
        data: [...uniquePrintingTypes.values()].map((type) => ({
          productId: product.id,
          zecatTypeId: String(type.id),
          name: type.name,
        })),
      });
    }

    return existing ? "updated" : "created";
  });
}

function toImageCreateInput(
  image: ZecatImage,
  index: number,
  productId: string,
  variantId: string | null
) {
  const url = resolveImageUrl(image);
  if (!url) return null;

  return {
    productId,
    variantId,
    url,
    isMain: image.main ?? false,
    sortOrder: index,
  };
}

export async function syncZecatCatalog(): Promise<SyncSummary> {
  const summary: SyncSummary = {
    total: 0,
    created: 0,
    updated: 0,
    failed: 0,
    usdWarnings: [],
    errors: [],
  };

  for await (const listItem of iterateAllGenericProducts()) {
    summary.total++;

    try {
      const detail = await fetchGenericProductDetail(listItem.id);

      if (detail.currency === "USD") {
        summary.usdWarnings.push({ zecatId: detail.id, name: detail.name });
        console.warn(
          `[zecat-sync] currency="USD" sospechoso en producto ${detail.id} (${detail.name}) — se guarda como ARS sin convertir.`
        );
      }

      const result = await syncProduct(detail);
      if (result === "created") summary.created++;
      else summary.updated++;
    } catch (error) {
      summary.failed++;
      summary.errors.push({
        zecatId: listItem.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

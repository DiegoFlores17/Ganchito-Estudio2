import { Currency, ProductOrigin, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { iterateAllProducts } from "./client";
import {
  buildSku,
  extractCostPrice,
  hasNoUsableImages,
  mapStock,
  slugifyCategory,
  splitIcons,
  variantImageUrls,
} from "./normalize";
import type { CdoCategory, CdoProduct } from "./types";

export interface CdoSyncSummary {
  total: number;
  created: number;
  updated: number;
  failed: number;
  /// Productos importados con active:false por no tener NI UNA imagen usable.
  /// El sync los vuelve a evaluar en cada corrida: si CDO les carga la foto,
  /// se reactivan solos.
  sinImagen: Array<{ cdoId: number; name: string }>;
  /// Variantes cuyo sku venia vacio y se sintetizo desde el id.
  skuSintetico: number;
  /// Iconos que no estan en ninguna de las dos listas de clasificacion.
  /// NO se descartan en silencio: hay que mirarlos y clasificarlos a mano.
  iconosDesconocidos: Array<{ id: number; label: string | null }>;
  errors: Array<{ cdoId: number; message: string }>;
}

type Tx = Prisma.TransactionClient;

/// Upsert de la categoria por cdoCategoryId.
///
/// Se importan TODAS, incluidas las de campaña ("Día de la Madre", "Precios
/// Wow"): filtrarlas por nombre desde el conector seria adivinar. La
/// visibilidad se resuelve con el campo editable desde el panel que ya esta
/// planteado en PENDIENTES, que sirve igual para Zecat y para CDO.
async function resolveCategoryId(
  tx: Tx,
  category: CdoCategory | undefined
): Promise<string | null> {
  if (!category) return null;

  const existing = await tx.category.findUnique({
    where: { cdoCategoryId: String(category.id) },
    select: { id: true },
  });
  if (existing) {
    await tx.category.update({
      where: { id: existing.id },
      data: { name: category.name },
    });
    return existing.id;
  }

  // El slug es unico a nivel tabla y puede chocar contra una categoria de
  // Zecat que se llame parecido. Si pasa, se desambigua con el id de CDO en
  // vez de romper el sync entero.
  const slug = slugifyCategory(category.name, category.id);
  const slugTomado = await tx.category.findUnique({
    where: { slug },
    select: { id: true },
  });

  const created = await tx.category.create({
    data: {
      cdoCategoryId: String(category.id),
      name: category.name,
      slug: slugTomado ? `${slug}-cdo-${category.id}` : slug,
    },
  });
  return created.id;
}

/// Sincroniza un producto de CDO. Igual que el conector de Zecat, cada
/// producto va en su propia transaccion: si uno falla, no frena a los demas ni
/// queda a medio escribir.
export async function syncCdoProduct(
  product: CdoProduct,
  summary: CdoSyncSummary
): Promise<"created" | "updated"> {
  const variants = product.variants ?? [];
  const icons = splitIcons(product.icons);

  for (const icon of icons.unknown) {
    if (!summary.iconosDesconocidos.some((i) => i.id === icon.id)) {
      summary.iconosDesconocidos.push({ id: icon.id, label: icon.label });
    }
  }

  const sinImagen = hasNoUsableImages(product);
  if (sinImagen) {
    summary.sinImagen.push({ cdoId: product.id, name: product.name });
  }

  return prisma.$transaction(async (tx) => {
    const categoryId = await resolveCategoryId(tx, product.categories?.[0]);

    const productData = {
      origin: ProductOrigin.CDO,
      name: product.name,
      description: product.description,
      // Los precios de CDO vienen en dolares. La conversion a pesos se hace
      // AL LEER, con PricingConfig.usdRate — no se guarda nada convertido.
      currency: Currency.USD,
      // CDO no expone minimo de personalizacion.
      minOrderQuantity: null,
      // El `packing` de CDO son medidas del EMBALAJE, no del producto: no se
      // mapea a las dimensiones, que estan documentadas como las del producto.
      // Ademas viene null en 160 de 207 casos.
      //
      // CDO tampoco tiene flag de publicado, asi que active sale de si el
      // producto tiene alguna foto usable.
      active: !sinImagen,
      categoryId,
      lastSyncedAt: new Date(),
    };

    const existing = await tx.product.findUnique({
      where: { cdoId: String(product.id) },
      select: { id: true },
    });

    const saved = await tx.product.upsert({
      where: { cdoId: String(product.id) },
      update: productData,
      create: { cdoId: String(product.id), ...productData },
    });

    // Variantes: upsert por sku, que es la clave real.
    for (const variant of variants) {
      const costPrice = extractCostPrice(variant);
      // Sin precio no se puede vender: se saltea la variante en vez de
      // inventar un costo.
      if (!costPrice) continue;

      const sku = buildSku(product.id, variant);
      if (!(variant.sku ?? "").trim()) summary.skuSintetico++;

      const { stock, reservedStock } = mapStock(variant);
      const variantData = {
        productId: saved.id,
        colorName: variant.color?.name ?? null,
        colorHex: variant.color?.hex_code ?? null,
        sizeName: null,
        materialName: null,
        stock,
        reservedStock,
        active: true,
        costPrice,
      };

      await tx.productVariant.upsert({
        where: { sku },
        update: variantData,
        create: { sku, ...variantData },
      });
    }

    // Imagenes, tecnicas y atributos no tienen clave estable: se borran
    // (scoped a este producto) y se recrean dentro de la misma transaccion.
    await tx.productImage.deleteMany({ where: { productId: saved.id } });
    await tx.productPrintingType.deleteMany({ where: { productId: saved.id } });
    await tx.productAttribute.deleteMany({ where: { productId: saved.id } });

    const dbVariants = await tx.productVariant.findMany({
      where: { productId: saved.id },
      select: { id: true, sku: true },
    });
    const variantIdBySku = new Map(dbVariants.map((v) => [v.sku, v.id]));

    // La foto principal del PRODUCTO sale de la primera imagen usable de
    // CUALQUIER variante, no necesariamente de la primera.
    //
    // Importa mas de lo que parece: getFeaturedProducts exige
    // `images: { some: { isMain: true } }`, asi que un producto sin imagen
    // marcada como principal no aparece nunca en la home.
    let yaMarcoPrincipal = false;
    const imageRows: Prisma.ProductImageCreateManyInput[] = [];

    for (const variant of variants) {
      const variantId = variantIdBySku.get(buildSku(product.id, variant)) ?? null;
      const urls = variantImageUrls(variant);

      urls.forEach((url, index) => {
        const esPrincipal = !yaMarcoPrincipal;
        if (esPrincipal) yaMarcoPrincipal = true;

        imageRows.push({
          productId: saved.id,
          // La principal se guarda a nivel producto (variantId null) para que
          // la card del catalogo la encuentre; el resto queda por variante.
          variantId: esPrincipal ? null : variantId,
          url,
          isMain: esPrincipal,
          sortOrder: index,
        });
      });
    }

    if (imageRows.length) {
      await tx.productImage.createMany({ data: imageRows });
    }

    if (icons.printingTypes.length) {
      // Deduplicado por nombre, mismo criterio que el conector de Zecat: en la
      // ficha solo mostramos QUE tecnica admite el producto.
      const porNombre = new Map(
        icons.printingTypes
          .filter((i) => i.label)
          .map((i) => [i.label as string, i])
      );
      await tx.productPrintingType.createMany({
        data: [...porNombre.values()].map((icon) => ({
          productId: saved.id,
          name: icon.label as string,
        })),
      });
    }

    if (icons.attributes.length) {
      const porNombre = new Map(
        icons.attributes.filter((i) => i.label).map((i) => [i.label as string, i])
      );
      await tx.productAttribute.createMany({
        data: [...porNombre.values()].map((icon) => ({
          productId: saved.id,
          externalId: String(icon.id),
          name: icon.label as string,
          iconUrl: icon.picture,
        })),
      });
    }

    return existing ? "updated" : "created";
  });
}

export async function syncCdoCatalog(): Promise<CdoSyncSummary> {
  const summary: CdoSyncSummary = {
    total: 0,
    created: 0,
    updated: 0,
    failed: 0,
    sinImagen: [],
    skuSintetico: 0,
    iconosDesconocidos: [],
    errors: [],
  };

  for await (const product of iterateAllProducts()) {
    summary.total++;

    try {
      const result = await syncCdoProduct(product, summary);
      if (result === "created") summary.created++;
      else summary.updated++;
    } catch (error) {
      summary.failed++;
      summary.errors.push({
        cdoId: product.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (summary.sinImagen.length) {
    console.warn(
      `[cdo-sync] ${summary.sinImagen.length} producto(s) importados INACTIVOS por no tener ninguna imagen usable. Se reactivan solos si CDO les carga la foto.`
    );
  }
  if (summary.iconosDesconocidos.length) {
    console.warn(
      `[cdo-sync] ${summary.iconosDesconocidos.length} icono(s) sin clasificar — hay que agregarlos a normalize.ts: ` +
        summary.iconosDesconocidos.map((i) => `${i.id} (${i.label})`).join(", ")
    );
  }

  return summary;
}

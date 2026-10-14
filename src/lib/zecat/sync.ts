import { Currency, Prisma, ProductOrigin } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  extractCostPrice,
  extractRangeDiscount,
  flattenVariants,
  mapVariantAttributes,
  parseStock,
  resolveImageUrl,
  slugifyFamily,
  toDecimalOrNull,
} from "./normalize";
import type { ZecatFamily, ZecatGenericProduct, ZecatImage } from "./types";

async function resolveCategoryId(
  family: ZecatFamily | undefined
): Promise<string | null> {
  if (!family) return null;

  // El slug es unico GLOBAL y los dos proveedores traen campañas homonimas
  // ("Dia de la Madre" la tienen Zecat Y CDO): si la familia es nueva y su
  // slug ya esta tomado por una categoria de otro origen, el create choca.
  // Paso al descubierto el 2026-08-31: Zecat le cambio las familias al 5206
  // EN MEDIO del sync de produccion y el choque revirtio la transaccion del
  // producto entero, que quedo con el costo viejo.
  //
  // Se captura la violacion y se reintenta con sufijo, NO se consulta antes
  // de crear: entre el "¿existe?" y el create hay ventana de carrera. El
  // slug con sufijo es interno — el filtro publico lo maneja la categoria
  // canonica del panel, asi que el sufijo no le llega al cliente.
  //
  // IMPORTANTE: esta funcion corre FUERA de la transaccion del producto.
  // En Postgres, una violacion de constraint ABORTA la transaccion entera
  // (25P02: los comandos siguientes fallan hasta el rollback), asi que el
  // catch-y-reintento solo funciona con upserts independientes. El upsert
  // de categoria es idempotente: si la transaccion del producto despues
  // falla, queda una categoria de mas, que es inocuo.
  try {
    const category = await prisma.category.upsert({
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
        // Nace OCULTA y esperando revision. Va solo en `create`: el `update`
        // de arriba no menciona `visible`, y Prisma escribe unicamente los
        // campos presentes, asi que una categoria que el cliente ya hizo
        // visible NUNCA vuelve a ocultarse en una corrida posterior.
        visible: false,
      },
    });
    return category.id;
  } catch (error) {
    const esColisionDeSlug =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002";
    if (!esColisionDeSlug) throw error;

    const category = await prisma.category.upsert({
      where: { zecatFamilyId: String(family.id) },
      update: {
        name: family.description,
        iconUrl: family.icon_url ?? null,
      },
      create: {
        zecatFamilyId: String(family.id),
        name: family.description,
        // Sufijo con el id de la familia: unico por construccion (el
        // zecatFamilyId ya es unique), y deja rastro de donde salio.
        slug: `${slugifyFamily(family)}-zecat-${family.id}`,
        iconUrl: family.icon_url ?? null,
        // Igual que en el camino feliz: nace oculta. Este `create` es el del
        // reintento por colision de slug — si se olvidara aca, las categorias
        // homonimas entre proveedores (las que MAS ruido hacen) entrarian
        // visibles y el olvido solo se notaria en produccion.
        visible: false,
      },
    });
    console.warn(
      `[zecat-sync] Slug en colision para la familia ${family.id} ("${family.description}"): creada como "${category.slug}".`
    );
    return category.id;
  }
}

export interface SyncProductResult {
  outcome: "created" | "updated";
  /// Variantes que estaban activas y esta corrida ya no trajo.
  variantesDesactivadas: number;
  /// true si el producto vino sin ninguna variante vendible y quedo inactivo.
  sinVariantes: boolean;
}

/// Sincroniza un solo producto (detalle completo) contra la base.
/// Todo el sync de un producto (producto, variantes, imágenes, áreas y
/// tipos de impresión) corre dentro de una única transacción: si algo
/// falla a mitad de camino, no queda el producto con imágenes borradas
/// y sin recrear.
export async function syncProduct(
  detail: ZecatGenericProduct
): Promise<SyncProductResult> {
  const variants = flattenVariants(detail.variants);

  // Un producto sin ninguna variante vendible no se puede cotizar: queda
  // inactivo. Paso con el 5699 (Neceser Weg): Zecat lo sigue publicando,
  // pero con `variants: {}` mientras espera reposicion. Se recalcula en cada
  // corrida, asi que se reactiva solo cuando vuelven las variantes — mismo
  // mecanismo que `published`.
  const sinVariantes = !variants.some((v) => v.active ?? true);

  // El costo se calcula POR VARIANTE (price publico x descuento de partner
  // de esa variante) y ANTES de la transaccion: si alguna variante no tiene
  // discount_partner valido, ZecatPricingError corta el producto entero sin
  // haber escrito nada. Sin fallback a proposito — ver extractCostPrice().
  const costBySku = new Map<string, number>();
  for (const variant of variants) {
    costBySku.set(variant.sku, extractCostPrice(detail, variant));
  }

  // SEGUNDA capa: el descuento de rango de cada variante. No modifica el costo
  // guardado — se persiste el porcentaje y se aplica al LEER, en funcion de la
  // cantidad, porque la escala arranca en 2 unidades y hornearlo en costPrice
  // cotizaria un pedido de 1 al precio de 2 (por debajo del costo real). Que
  // devuelva null es normal: 250 de las 1.849 variantes no tienen descuento.
  const discountBySku = new Map<string, ReturnType<typeof extractRangeDiscount>>();
  for (const variant of variants) {
    discountBySku.set(variant.sku, extractRangeDiscount(variant));
  }

  // Fuera de la transaccion a proposito — ver el comentario de la funcion.
  const categoryId = await resolveCategoryId(detail.families?.[0]);

  return prisma.$transaction(async (tx) => {

    const productData = {
      origin: ProductOrigin.ZECAT,
      externalId: detail.external_id ?? null,
      name: detail.name,
      description: detail.description,
      // El costo NO va mas en el producto: vive en cada variante (abajo).
      //
      // El campo currency de Zecat no es confiable (ver SyncSummary.usdWarnings):
      // por ahora asumimos ARS siempre y no convertimos nada.
      //
      // NO "ARREGLAR" ESTO LEYENDO detail.currency. Los seis productos
      // textiles con descuento de lista (Remera Regent 5410/5413, Lincoln
      // 5708, Chomba Summer II 5412, Cutralco 5883, Passion 5411) vienen
      // marcados "USD" con precios que son claramente pesos: la Regent trae
      // price 12893.99, que son $12.893 y no USD 12.893. Confiar en el campo
      // multiplicaria esos precios por la cotizacion del dolar.
      //
      // Y ahora eso se AMPLIFICA: sobre ese costo inflado se aplicarian dos
      // capas de descuento (discount_partner y el de rango), asi que el
      // numero resultante quedaria en un orden de magnitud creible —
      // suficiente para pasar una revision por arriba. Un precio 1.500 veces
      // mas alto se ve; uno mal por dos descuentos sobre una base equivocada,
      // no. Si alguna vez se toca esto, hay que verificarlo producto por
      // producto contra el backoffice, no confiando en el campo.
      currency: Currency.ARS,
      // El minimo de compra sale de minimum_application_quantity, NO de
      // minimum_order_quantity: ese ultimo es un umbral logistico del
      // proveedor (Zecat vende desde 1 unidad aunque diga 4786) y usarlo
      // como minimo de venta hacia incotizable al 21% del catalogo.
      // Verificado contra su backoffice — ver el comentario del schema.
      minOrderQuantity: detail.minimum_application_quantity ?? null,
      // Se conserva crudo: no es un minimo de venta, pero es informacion
      // del proveedor que puede servir despues.
      supplierMinOrderQuantity: detail.minimum_order_quantity ?? null,
      heightCm: toDecimalOrNull(detail.dimensions?.height),
      widthCm: toDecimalOrNull(detail.dimensions?.width),
      lengthCm: toDecimalOrNull(detail.dimensions?.length),
      weightG: toDecimalOrNull(detail.dimensions?.weight),
      active: (detail.published ?? true) && !sinVariantes,
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
      // Calculado arriba, antes de la transaccion. El costo es POR VARIANTE:
      // el discount_partner viene en cada una y puede variar.
      const costPrice = costBySku.get(variant.sku)!;

      // Los cuatro campos van SIEMPRE, tambien cuando no hay descuento: si la
      // variante deja de tenerlo del lado de Zecat, hay que borrar lo que
      // quedo guardado. Omitirlos en ese caso dejaria aplicandose para siempre
      // un descuento que el proveedor ya saco.
      const discount = discountBySku.get(variant.sku) ?? null;
      const discountData = {
        discountExternalId: discount?.externalId ?? null,
        discountName: discount?.name ?? null,
        discountPercent: discount?.percent ?? null,
        // El cast es por el tipo de las columnas Json de Prisma, que pide un
        // InputJsonValue con index signature; RangeDiscountTier[] es
        // estructuralmente valido pero no lo satisface.
        discountTiers: discount
          ? (discount.tiers as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
      };

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
          costPrice,
          ...discountData,
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
          ...discountData,
        },
      });
    }

    // Las variantes que el proveedor dejo de mandar se DESACTIVAN, no se
    // borran: el sku sigue existiendo para las cotizaciones ya emitidas
    // (QuoteItem guarda el sku como texto y el precio congelado). Sin esto
    // quedaban a la venta con el stock de la ultima vez que vinieron — en
    // produccion habia 33 variantes cotizables que Zecat ya no ofrecia. Si
    // vuelven, el upsert de arriba las reactiva.
    const desactivadas = await tx.productVariant.updateMany({
      where: {
        productId: product.id,
        sku: { notIn: variants.map((v) => v.sku) },
        active: true,
      },
      data: { active: false },
    });

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
      .map((image, index) =>
        toImageCreateInput(image, index, product.id, null, detail.id)
      )
      .filter((image): image is NonNullable<typeof image> => image !== null);

    const variantImages = variants.flatMap((variant) =>
      (variant.images ?? [])
        .map((image, index) =>
          toImageCreateInput(
            image,
            index,
            product.id,
            variantIdBySku.get(variant.sku) ?? null,
            detail.id
          )
        )
        .filter((image): image is NonNullable<typeof image> => image !== null)
    );

    // Zecat a veces manda MAS de una imagen con main:true (visto en los
    // productos 5156 y 4137: dos imagenes de producto marcadas main). Como
    // el catalogo hace take:1 sin orderBy, cual se muestra queda al azar.
    // Gana la primera en orden de aparicion; el resto se degrada.
    const allImages = [...productImages, ...variantImages];
    let mainVisto = false;
    for (const image of allImages) {
      if (!image.isMain) continue;
      if (mainVisto) image.isMain = false;
      mainVisto = true;
    }

    if (allImages.length) {
      await tx.productImage.createMany({ data: allImages });
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

    return {
      outcome: existing ? "updated" : "created",
      variantesDesactivadas: desactivadas.count,
      sinVariantes,
    } satisfies SyncProductResult;
  });
}

function toImageCreateInput(
  image: ZecatImage,
  index: number,
  productId: string,
  variantId: string | null,
  zecatId: string | number
) {
  const url = resolveImageUrl(image);
  // Sin URL no hay nada que guardar, pero el descarte se LOGUEA, no se
  // traga: si Zecat renombra el campo de la URL, esto es lo unico que
  // separa "productos sin imagen y nadie se entero" de un aviso a tiempo.
  // Mismo criterio que discount_partner: fallar visible.
  if (!url) {
    console.warn(
      `[zecat-sync] Imagen descartada del producto ${zecatId}: sin image_url/imageUrl (indice ${index}${variantId ? ", variante" : ""}).`
    );
    return null;
  }

  return {
    productId,
    variantId,
    url,
    isMain: image.main ?? false,
    sortOrder: index,
  };
}

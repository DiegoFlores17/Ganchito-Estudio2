import { Currency, ProductOrigin, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { iterateAllProducts } from "./client";
import {
  buildSku,
  candidateImageUrls,
  extractCostPrice,
  hasNoUsableImages,
  mapStock,
  probeImage,
  slugifyCategory,
  splitIcons,
  variantImageUrls,
  type IconUnknownReason,
  type ImageProbe,
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
  /// Iconos que no se pudieron clasificar. NO se descartan en silencio: hay
  /// que mirarlos y resolverlos a mano.
  ///
  /// Se distinguen dos casos porque significan cosas MUY distintas: un id
  /// nuevo es CDO agregando algo, y un label cambiado es un id reutilizado —
  /// o sea, la clasificacion que teniamos guardada apuntaba a otra cosa.
  iconosDesconocidos: Array<{
    id: number;
    label: string | null;
    reason: IconUnknownReason;
    expectedLabel?: string;
  }>;
  /// Calidad de las PORTADAS. Se sigue midiendo en cada corrida, pero ya NO
  /// es un problema del proveedor: medido contra la API de produccion el
  /// 2026-08-25, 300 de 301 portadas estan bien (0,3% con problema). El 15,2%
  /// que habiamos visto era del entorno de PRUEBAS.
  portadas: { ok: number; deformes: number; chicas: number; rotas: number };
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
  summary: CdoSyncSummary,
  probes: Map<string, ImageProbe>
): Promise<"created" | "updated"> {
  const variants = product.variants ?? [];
  const icons = splitIcons(product.icons);

  for (const desconocido of icons.unknown) {
    const { icon, reason, expectedLabel } = desconocido;
    if (!summary.iconosDesconocidos.some((i) => i.id === icon.id)) {
      summary.iconosDesconocidos.push({
        id: icon.id,
        label: icon.label,
        reason,
        expectedLabel,
      });
    }
  }

  const sinImagen = hasNoUsableImages(product, probes);
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
      const urls = variantImageUrls(variant, probes);

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
    portadas: { ok: 0, deformes: 0, chicas: 0, rotas: 0 },
    errors: [],
  };

  // 1. Bajar el catalogo entero. Son 3 requests: el listado ya trae todo.
  const products: CdoProduct[] = [];
  for await (const product of iterateAllProducts()) products.push(product);

  // 2. Medir las imagenes ANTES de escribir nada.
  //
  // Va aca y no dentro del sync de cada producto por una razon dura: cada
  // producto se escribe en una transaccion, y hacer llamadas de red adentro
  // de una transaccion la mantiene abierta esperando a la red. Eso agarra
  // conexiones del pool y, con 627 imagenes, es pedir problemas.
  const urls = [...new Set(products.flatMap((p) => candidateImageUrls(p)))];
  const probes = new Map<string, ImageProbe>();
  const LOTE = 12;
  for (let i = 0; i < urls.length; i += LOTE) {
    await Promise.all(
      urls.slice(i, i + LOTE).map(async (url) => {
        probes.set(url, await probeImage(url));
      })
    );
  }

  // 3. Recien ahora, escribir.
  for (const product of products) {
    summary.total++;

    // Calidad de la PORTADA: la primera imagen usable de cualquier variante,
    // que es la que termina en la card del catalogo.
    const portada = candidateImageUrls(product)[0];
    const probe = portada ? probes.get(portada) : undefined;
    if (probe) {
      if (probe.verdict === "ok") summary.portadas.ok++;
      else if (probe.verdict === "deforme") summary.portadas.deformes++;
      else if (probe.verdict === "chica") summary.portadas.chicas++;
      else summary.portadas.rotas++;
    }

    try {
      const result = await syncCdoProduct(product, summary, probes);
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
  // Los dos casos se loguean POR SEPARADO porque piden acciones distintas.
  const idsNuevos = summary.iconosDesconocidos.filter((i) => i.reason === "id-nuevo");
  const labelsCambiados = summary.iconosDesconocidos.filter(
    (i) => i.reason === "label-cambiado"
  );

  if (idsNuevos.length) {
    console.warn(
      `[cdo-sync] ${idsNuevos.length} icono(s) con id NUEVO — agregarlos a normalize.ts decidiendo si son tecnica o atributo: ` +
        idsNuevos.map((i) => `${i.id} ("${i.label}")`).join(", ")
    );
  }

  if (labelsCambiados.length) {
    // Esto no es un aviso mas: significa que CDO reutilizo un id para otra
    // cosa y que la clasificacion guardada apuntaba a algo distinto. Los
    // iconos afectados NO se guardaron, a proposito.
    console.error(
      `[cdo-sync] ATENCION — ${labelsCambiados.length} icono(s) CAMBIARON DE SIGNIFICADO. ` +
        `No se clasificaron (mejor perderlos que guardarlos mal). Revisar normalize.ts: ` +
        labelsCambiados
          .map((i) => `id ${i.id}: esperabamos "${i.expectedLabel}" y vino "${i.label}"`)
          .join(" · ")
    );
  }

  const { ok, deformes, chicas, rotas } = summary.portadas;
  const malas = deformes + chicas + rotas;
  console.log(
    `[cdo-sync] Calidad de portadas: ${ok} ok, ${deformes} deformes (se muestran con object-contain), ${chicas} muy chicas y ${rotas} rotas (descartadas). ${malas} de ${ok + malas} con algun problema.`
  );

  return summary;
}

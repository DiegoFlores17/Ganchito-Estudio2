import { Currency, Prisma, ProductOrigin } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { umbralDeSeguridad } from "@/lib/sync-run";
import {
  buildSku,
  extractCostPrice,
  estadoDeFotos,
  mapStock,
  slugifyCategory,
  splitIcons,
  variantImageUrls,
  type IconUnknownReason,
  type ImageProbe,
} from "./normalize";
import type { CdoCategory, CdoProduct } from "./types";
import {
  calcularPublicHash,
  clasificarCambio,
  invalidaCache,
  type ClaseCambio,
  type DatosPublicos,
} from "@/lib/sync/cambios";

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
  /// Variantes salteadas por no traer net_price. Deberia quedar vacio
  /// siempre: si aparece algo, CDO cambio el contrato de precios.
  variantesSinPrecio: Array<{ cdoId: number; name: string; variantId: number }>;
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
  /// Variantes que estaban activas y esta corrida ya no trajo (o trajo sin
  /// net_price): quedan inactivas, no se borran.
  variantesDesactivadas: number;
  /// Productos que vinieron sin ninguna variante vendible: quedan inactivos
  /// hasta que vuelvan.
  sinVariantes: Array<{ cdoId: number; name: string }>;
  errors: Array<{ cdoId: number; message: string }>;
}

/// Upsert de la categoria por cdoCategoryId.
///
/// Se importan TODAS, incluidas las de campaña ("Día de la Madre", "Precios
/// Wow"): filtrarlas por nombre desde el conector seria adivinar. La
/// visibilidad se decide desde el panel.
///
/// Las que se CREAN nacen ocultas (`visible: false`) y esperando revision.
/// Las que YA EXISTEN no se tocan: el `update` de abajo escribe unicamente
/// `name`, asi que una categoria que el cliente ya hizo visible no puede
/// volver a ocultarse en una corrida posterior. Son dos caminos separados y
/// el de actualizacion ni siquiera menciona el campo.
async function resolveCategoryId(
  category: CdoCategory | undefined
): Promise<string | null> {
  if (!category) return null;

  // FUERA de la transaccion del producto, a proposito (mismo fix que el 5206
  // de Zecat): en Postgres una violacion de constraint ABORTA la transaccion
  // entera, asi que un choque de slug adentro tumbaba el producto. Afuera,
  // se captura P2002 y se reintenta con sufijo. Antes se hacia
  // consultar-y-crear, que deja ventana de carrera entre el "¿existe?" y el
  // create; ahora decide la base.
  const crear = (slug: string) =>
    prisma.category.upsert({
      where: { cdoCategoryId: String(category.id) },
      // Solo el nombre: una categoria que el cliente ya hizo visible no puede
      // volver a ocultarse en una corrida posterior.
      update: { name: category.name },
      // Nace oculta: el ruido del proveedor no llega al catalogo hasta que
      // alguien lo apruebe.
      create: { cdoCategoryId: String(category.id), name: category.name, slug, visible: false },
      select: { id: true },
    });

  const slug = slugifyCategory(category.name, category.id);
  try {
    return (await crear(slug)).id;
  } catch (error) {
    const choqueDeSlug =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (!choqueDeSlug) throw error;
    // El slug es unico a nivel tabla y puede chocar contra una categoria de
    // Zecat que se llame parecido: se desambigua con el id de CDO.
    const conSufijo = `${slug}-cdo-${category.id}`;
    console.warn(`[cdo-sync] Slug en colision para la categoria ${category.id} ("${category.name}"): se usa "${conSufijo}".`);
    return (await crear(conSufijo)).id;
  }
}

/// Sincroniza un producto de CDO. Igual que el conector de Zecat, cada
/// producto va en su propia transaccion: si uno falla, no frena a los demas ni
/// queda a medio escribir.
export async function syncCdoProduct(
  product: CdoProduct,
  summary: CdoSyncSummary,
  probes: Map<string, ImageProbe>,
  /// URLs que no se pudieron medir y nunca se habian medido (ver
  /// medirConCache). Si el producto depende de ellas, conserva su estado.
  sinMedir: ReadonlySet<string> = new Set(),
  /// false: la corrida ya llego al tope de apagados por foto (ver motor.ts).
  /// Un activo que se queda sin foto conserva su estado y sus imagenes.
  puedeApagarSinFoto = true
): Promise<{
  outcome: "created" | "updated";
  variantesDesactivadas: number;
  /// Estaba activo y se quedo sin foto usable: "apagado" si se apago,
  /// "retenido" si conservo su estado por el tope.
  sinFoto?: "apagado" | "retenido";
  fotos: "con-foto" | "sin-foto" | "indeterminado";
  /// Product.id: para invalidar la cache publica de su ficha.
  productId: string;
  /// Que cambio respecto de lo que habia (ver lib/sync/cambios.ts).
  cambio: ClaseCambio;
}> {
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

  const fotos = estadoDeFotos(product, probes, sinMedir);
  if (fotos === "sin-foto") {
    summary.sinImagen.push({ cdoId: product.id, name: product.name });
  }

  // Sin ninguna variante vendible (con net_price) el producto no se puede
  // cotizar: queda inactivo. Se recalcula en cada corrida, igual que la
  // regla de las fotos, asi que se reactiva solo.
  const sinVariantes = !tieneVariantesVendibles(product);
  if (sinVariantes) {
    summary.sinVariantes.push({ cdoId: product.id, name: product.name });
  }

  // Fuera de la transaccion a proposito — ver resolveCategoryId.
  const categoryId = await resolveCategoryId(product.categories?.[0]);

  // Variantes vendibles, resueltas ANTES de la transaccion: el hash de lo
  // publico (cambios.ts) las necesita para decidir si hay que invalidar la
  // cache, y se calcula antes del upsert.
  const filas: Array<{
    variant: (typeof variants)[number];
    sku: string;
    costPrice: NonNullable<ReturnType<typeof extractCostPrice>>;
    stock: number;
    reservedStock: number;
  }> = [];
  for (const variant of variants) {
    const costPrice = extractCostPrice(variant);
    // Sin net_price no se puede vender: se saltea la variante en vez de
    // inventar un costo. Y se LOGUEA — un descarte mudo es como se pierden
    // productos sin que nadie se entere (la leccion de las imagenes de
    // Zecat). Si esto empieza a aparecer, CDO cambio algo.
    if (!costPrice) {
      summary.variantesSinPrecio.push({
        cdoId: product.id,
        name: product.name,
        variantId: variant.id,
      });
      console.warn(
        `[cdo-sync] Variante ${variant.id} del producto ${product.id} (${product.name}) SIN net_price: se saltea.`
      );
      continue;
    }
    const sku = buildSku(product.id, variant);
    if (!(variant.sku ?? "").trim()) summary.skuSintetico++;
    const { stock, reservedStock } = mapStock(variant);
    filas.push({ variant, sku, costPrice, stock, reservedStock });
  }

  // Imagenes a escribir, por sku de variante. La foto principal del PRODUCTO
  // sale de la primera imagen usable de CUALQUIER variante, no
  // necesariamente de la primera.
  //
  // Importa mas de lo que parece: getFeaturedProducts exige
  // `images: { some: { isMain: true } }`, asi que un producto sin imagen
  // marcada como principal no aparece nunca en la home.
  let yaMarcoPrincipal = false;
  const imagenes: Array<{ url: string; isMain: boolean; sortOrder: number; variantSku: string | null }> = [];
  for (const variant of variants) {
    const variantSku = buildSku(product.id, variant);
    variantImageUrls(variant, probes).forEach((url, index) => {
      const esPrincipal = !yaMarcoPrincipal;
      if (esPrincipal) yaMarcoPrincipal = true;
      // La principal se guarda a nivel producto (variantId null) para que la
      // card del catalogo la encuentre; el resto queda por variante.
      imagenes.push({ url, isMain: esPrincipal, sortOrder: index, variantSku: esPrincipal ? null : variantSku });
    });
  }

  const tiposImpresion = [
    ...new Map(icons.printingTypes.filter((i) => i.label).map((i) => [i.label as string, i])).values(),
  ];
  const atributos = [
    ...new Map(icons.attributes.filter((i) => i.label).map((i) => [i.label as string, i])).values(),
  ];

  return prisma.$transaction(async (tx) => {
    // UNA consulta antes de escribir: estado, huella anterior y stock de las
    // variantes, para clasificar el cambio (cambios.ts).
    const existing = await tx.product.findUnique({
      where: { cdoId: String(product.id) },
      select: {
        id: true,
        active: true,
        publicHash: true,
        variants: { select: { sku: true, stock: true, reservedStock: true } },
      },
    });

    // Foto indeterminada (no se pudo medir y nunca se midio): el producto
    // CONSERVA su estado. Un rato de CDN lenta no puede apagar productos que
    // estan bien. Uno nuevo entra inactivo: no hay estado que conservar, y
    // mostrar sin saber si tiene foto es peor que esperar a la proxima corrida.
    //
    // Sin foto estando activo, con la corrida ya en el tope: tambien conserva
    // su estado (y sus imagenes, ver abajo).
    // Si igual se apaga por no tener variantes vendibles, la foto no decide
    // nada: ni cuenta para el tope ni se "retiene" (se informaria como "sigue
    // a la venta" algo que no lo esta).
    const quedaSinFoto = fotos === "sin-foto" && existing?.active === true && !sinVariantes;
    const retenido = quedaSinFoto && !puedeApagarSinFoto;
    const activoPorFotos =
      fotos === "con-foto" || retenido
        ? true
        : fotos === "sin-foto"
          ? false
          : (existing?.active ?? false);

    const activo = activoPorFotos && !sinVariantes;

    // Un retenido NO reescribe sus imagenes: lo publico son las que ya tiene,
    // no las recien medidas. Es el unico caso en que hay que leerlas.
    const imagenesPublicas = retenido
      ? (
          await tx.productImage.findMany({
            where: { productId: existing!.id },
            select: { url: true, isMain: true, sortOrder: true, variant: { select: { sku: true } } },
          })
        ).map((i) => ({ url: i.url, isMain: i.isMain, sortOrder: i.sortOrder, variantSku: i.variant?.sku ?? null }))
      : imagenes;

    const datosPublicos: DatosPublicos = {
      name: product.name,
      description: product.description ?? null,
      currency: Currency.USD,
      minOrderQuantity: null,
      heightCm: null,
      widthCm: null,
      lengthCm: null,
      weightG: null,
      active: activo,
      categoryId,
      variantes: filas.map((f) => ({
        sku: f.sku,
        colorName: f.variant.color?.name ?? null,
        colorHex: f.variant.color?.hex_code ?? null,
        sizeName: null,
        materialName: null,
        costPrice: f.costPrice,
        discountPercent: null,
        discountTiers: null,
        active: true,
      })),
      imagenes: imagenesPublicas,
      areasImpresion: [],
      tiposImpresion: tiposImpresion.map((i) => ({ name: i.label as string })),
      atributos: atributos.map((i) => ({
        externalId: String(i.id),
        name: i.label as string,
        iconUrl: i.picture ?? null,
      })),
    };
    const publicHash = calcularPublicHash(datosPublicos);

    const productData = {
      origin: ProductOrigin.CDO,
      // El code de CDO (ej. "BP161"): es la clave del detalle
      // (/products/{code}), que la confirmacion de ausentes necesita. El id
      // sigue siendo la clave del upsert (cdoId).
      externalId: product.code,
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
      // producto tiene alguna foto usable — y alguna variante vendible.
      active: activo,
      categoryId,
      publicHash,
      lastSyncedAt: new Date(),
    };

    const cambio = clasificarCambio(
      existing ? { publicHash: existing.publicHash, variantes: existing.variants } : null,
      publicHash,
      filas.map((f) => ({ sku: f.sku, stock: f.stock, reservedStock: f.reservedStock }))
    );
    // La marca de "invalidacion pendiente" va en la MISMA escritura que el
    // cambio (ver Product.invalidacionPendienteDesde). Sin marca no se toca.
    const marca = invalidaCache(cambio) ? { invalidacionPendienteDesde: new Date() } : {};

    const saved = await tx.product.upsert({
      where: { cdoId: String(product.id) },
      update: { ...productData, ...marca },
      create: { cdoId: String(product.id), ...productData, ...marca },
    });

    // Variantes: upsert por sku, que es la clave real.
    for (const { variant, sku, costPrice, stock, reservedStock } of filas) {
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

    // Las variantes que CDO dejo de mandar (o mando sin net_price) se
    // DESACTIVAN, no se borran: el sku sigue existiendo para las cotizaciones
    // ya emitidas. Si vuelven, el upsert de arriba las reactiva. Mismo
    // criterio que el conector de Zecat.
    const desactivadas = await tx.productVariant.updateMany({
      where: { productId: saved.id, sku: { notIn: filas.map((f) => f.sku) }, active: true },
      data: { active: false },
    });

    // Imagenes, tecnicas y atributos no tienen clave estable: se borran
    // (scoped a este producto) y se recrean dentro de la misma transaccion.
    // Un retenido conserva las imagenes que tenia: recrearlas desde lo medido
    // lo dejaria activo y sin ninguna foto.
    if (!retenido) await tx.productImage.deleteMany({ where: { productId: saved.id } });
    await tx.productPrintingType.deleteMany({ where: { productId: saved.id } });
    await tx.productAttribute.deleteMany({ where: { productId: saved.id } });

    const dbVariants = await tx.productVariant.findMany({
      where: { productId: saved.id },
      select: { id: true, sku: true },
    });
    const variantIdBySku = new Map(dbVariants.map((v) => [v.sku, v.id]));

    if (imagenes.length && !retenido) {
      await tx.productImage.createMany({
        data: imagenes.map(({ variantSku, ...imagen }) => ({
          ...imagen,
          productId: saved.id,
          variantId: variantSku ? (variantIdBySku.get(variantSku) ?? null) : null,
        })),
      });
    }

    if (tiposImpresion.length) {
      // Deduplicado por nombre, mismo criterio que el conector de Zecat: en la
      // ficha solo mostramos QUE tecnica admite el producto.
      await tx.productPrintingType.createMany({
        data: tiposImpresion.map((icon) => ({
          productId: saved.id,
          name: icon.label as string,
        })),
      });
    }

    if (atributos.length) {
      await tx.productAttribute.createMany({
        data: atributos.map((icon) => ({
          productId: saved.id,
          externalId: String(icon.id),
          name: icon.label as string,
          iconUrl: icon.picture,
        })),
      });
    }

    // El conteo sale de la transaccion y se suma DESPUES del commit (en
    // syncCdoCatalog): si se sumara aca y la transaccion fallara despues,
    // el resumen contaria desactivaciones que nunca ocurrieron.
    return {
      outcome: existing ? ("updated" as const) : ("created" as const),
      variantesDesactivadas: desactivadas.count,
      sinFoto: retenido ? ("retenido" as const) : quedaSinFoto ? ("apagado" as const) : undefined,
      fotos,
      productId: saved.id,
      cambio,
    };
  });
}

/// Una variante es vendible si trae net_price: sin costo no se puede cotizar
/// (syncCdoProduct la saltea). Un producto sin ninguna queda inactivo.
export function tieneVariantesVendibles(product: CdoProduct): boolean {
  return (product.variants ?? []).some((v) => Boolean(extractCostPrice(v)));
}

/// Cuantos productos ACTIVOS hoy quedarian inactivos por venir sin variantes
/// vendibles. Cuenta TRANSICIONES, no el estado: un producto que ya estaba
/// vacio (e inactivo) desde corridas anteriores no suma — si sumara, un
/// grupo estable de vacios trabaria el sync para siempre, y cada corrida
/// achicaria el umbral (menos activos) empeorandolo. Primera importacion
/// (ningun activo todavia): no hay nada que proteger, no se frena.
export async function vaciosQueSeApagarian(products: CdoProduct[]) {
  const { umbral, activos, porcentaje } = await umbralDeSeguridad(ProductOrigin.CDO);
  const vacios = products
    .filter((p) => !tieneVariantesVendibles(p))
    .map((p) => String(p.id));
  const apagados =
    activos === 0 || vacios.length === 0
      ? []
      : await prisma.product.findMany({
          where: { origin: ProductOrigin.CDO, cdoId: { in: vacios }, active: true },
          select: { cdoId: true, name: true },
        });
  return { seApagarian: apagados.length, apagados, umbral, activos, porcentaje };
}

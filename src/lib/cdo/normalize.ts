import { Prisma } from "@prisma/client";
import type { CdoIcon, CdoProduct, CdoVariant } from "./types";

/// Ids de los iconos de CDO que son TECNICAS DE IMPRESION.
///
/// La clasificacion va por id explicito y NO por heuristica sobre el texto:
/// "Grabado láser gratis" y "Grabado en láser" se parecen muchisimo pero son
/// cosas distintas (una condicion comercial y una tecnica). Adivinar por el
/// nombre acierta hoy y falla callado el dia que agreguen uno.
///
/// Relevado sobre los 25 iconos del entorno de pruebas.
const PRINTING_TECHNIQUE_ICON_IDS = new Set([
  11, // Tampografía
  21, // Serigrafía
  31, // Grabado en láser
  41, // Grabado en pantógrafo
  51, // Transfer
  61, // Bordado
  62, // Bajo relieve
  69, // Calco Vitrificable
  70, // DTF (Transfer Digital)
  71, // DTF UV (Transfer Digital UV)
  76, // Grabado Láser UV
  77, // Impresión 360° Digital
  78, // Impresión Digital
  91, // Sublimación
]);

/// Ids que son ATRIBUTOS: certificaciones, caracteristicas y condiciones
/// comerciales. Van a ProductAttribute.
const ATTRIBUTE_ICON_IDS = new Set([
  1, // Caja de regalo
  63, // A Pedido
  66, // Apto lavavajillas
  67, // Apto microondas
  68, // BPA FREE
  74, // Grabado láser gratis      <- condicion comercial, no tecnica
  75, // grabado láser incluido    <- idem
  80, // INAL approved
  85, // MATERIALES RECICLADOS
  87, // RECICLABLE
  88, // REUTILIZABLE
]);

export interface IconSplit {
  printingTypes: CdoIcon[];
  attributes: CdoIcon[];
  /// Iconos que no estan en ninguna de las dos listas. NO se descartan en
  /// silencio: el sync los loguea para poder clasificarlos a mano.
  unknown: CdoIcon[];
}

/// Separa los `icons` de CDO en tecnicas de impresion y atributos.
export function splitIcons(icons: CdoIcon[] | null | undefined): IconSplit {
  const split: IconSplit = { printingTypes: [], attributes: [], unknown: [] };

  for (const icon of icons ?? []) {
    if (PRINTING_TECHNIQUE_ICON_IDS.has(icon.id)) split.printingTypes.push(icon);
    else if (ATTRIBUTE_ICON_IDS.has(icon.id)) split.attributes.push(icon);
    else split.unknown.push(icon);
  }

  return split;
}

/// Una imagen sirve si existe y no es el placeholder del proveedor.
///
/// CDO devuelve `.../pictures/original/missing.png` cuando no tiene foto, en
/// vez de mandar null. Son el 29% de las imagenes del entorno de pruebas (256
/// de 883): guardarlas seria llenar el catalogo de placeholders rotos.
export function isUsableImage(url: string | null | undefined): url is string {
  return !!url && !/\/missing\.png(\?|$)/i.test(url);
}

/// SKU de la variante, siempre prefijado con el id del producto de CDO.
///
/// Dos problemas distintos que resuelve el mismo prefijo:
///
/// 1. El `sku` de CDO viene VACIO en 13 de 411 variantes, y en nuestro schema
///    es la clave unica de ProductVariant. Para esas se usa el id de la
///    variante, que si es estable.
///
/// 2. Mas grave: CDO REPITE el mismo sku en productos DISTINTOS. "OCEAN"
///    (5799) y "BOTELLA OCEAN Y TAPA OCEAN KIT" (5798) comparten
///    "T625-01+T521T-400MZ" y "T625-01+T521T-00". Con sku unico global, el
///    upsert hacia que el segundo producto le ROBARA la variante al primero:
///    se perdian filas y, peor, la variante saltaba de producto segun el
///    orden de procesamiento — distinto resultado en cada corrida.
///
/// Por eso el prefijo va SIEMPRE y no solo cuando hay choque: prefijar solo
/// al detectar colision haria que el sku dependiera de que mas vino en esa
/// pagina. El sku crudo de CDO se recupera sacandole el prefijo.
export function buildSku(productId: number, variant: CdoVariant): string {
  const raw = (variant.sku ?? "").trim();
  return raw ? `cdo-${productId}-${raw}` : `cdo-${productId}-v${variant.id}`;
}

/// Stock, con la vuelta de rosca de CDO.
///
/// En Zecat el stock real se calcula: stock - reservedStock. En CDO
/// `stock_available` YA VIENE NETO — verificado sobre las 411 variantes:
/// available > existent no pasa NUNCA (0 casos), available === existent en
/// 375 y available < existent en 24.
///
/// Por eso el mapeo es stock = existent y reservedStock = existent - available:
/// asi nuestro calculo de siempre (stock - reservedStock) devuelve exactamente
/// `available`, y ademas se conserva el total.
///
/// Mapear available directo a reservedStock daria lo RESERVADO en vez de lo
/// disponible: el error estaria justo al reves.
export function mapStock(variant: CdoVariant): {
  stock: number;
  reservedStock: number;
} {
  // stock_existent viene null en 12 de 411: cae a 0, nunca a NaN.
  const existent = Math.max(0, Math.trunc(variant.stock_existent ?? 0));
  const available = Math.max(0, Math.trunc(variant.stock_available ?? 0));

  // Defensivo: si algun dia mandaran available > existent, el reservado no
  // puede ser negativo.
  const reserved = Math.max(0, existent - available);

  return { stock: existent, reservedStock: reserved };
}

/// Costo de la variante, en DOLARES.
///
/// Se usa net_price (el neto) y no list_price: es el que coincide con el
/// precio en U$S del catalogo web de CDO. Verificado que net_price <=
/// list_price siempre (326 menores, 85 iguales, 0 mayores).
///
/// La conversion a pesos NO se hace aca: se hace al leer, con
/// PricingConfig.usdRate (ver lib/pricing.ts).
export function extractCostPrice(variant: CdoVariant): Prisma.Decimal | null {
  const raw = variant.net_price ?? variant.list_price;
  if (raw === null || raw === undefined) return null;

  const value = new Prisma.Decimal(String(raw).trim() || "0");
  return value.greaterThan(0) ? value : null;
}

/// Slug de categoria a partir del nombre. CDO no manda slug, solo id y nombre.
export function slugifyCategory(name: string, id: number): string {
  const slug = name
    .normalize("NFD")
    // Marcas diacriticas combinantes, con escapes explicitos: escribirlas
    // literales sobrevive mal a copiar y pegar entre editores.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // Si el nombre no deja nada usable, el id garantiza unicidad.
  return slug || `cdo-${id}`;
}

/// Todas las imagenes usables de una variante, en orden de prioridad:
/// la principal, la de detalle y despues el resto.
///
/// Si se pasa el mapa de mediciones, ademas se descartan las rotas y las
/// demasiado chicas. Sin el mapa solo se filtra por nombre (missing.png).
export function variantImageUrls(
  variant: CdoVariant,
  probes?: Map<string, ImageProbe>
): string[] {
  const urls: string[] = [];

  if (isUsableImage(variant.picture?.original)) urls.push(variant.picture!.original!);
  if (isUsableImage(variant.detail_picture?.original)) {
    urls.push(variant.detail_picture!.original!);
  }
  for (const other of variant.other_pictures ?? []) {
    if (isUsableImage(other.original)) urls.push(other.original!);
  }

  const unicas = [...new Set(urls)];
  return probes ? unicas.filter((u) => probeAceptada(probes.get(u))) : unicas;
}

/// Todas las URLs candidatas de un producto, ANTES de medirlas. Se usa para
/// juntar la lista a medir de una sola pasada.
export function candidateImageUrls(product: CdoProduct): string[] {
  return [...new Set((product.variants ?? []).flatMap((v) => variantImageUrls(v)))];
}

/// Ancho/alto minimo para aceptar una foto de producto.
///
/// CDO tiene imagenes que son claramente basura y NO son missing.png: la
/// portada de "BOTELLA DAKOTA Y TAPA OCEAN KIT" es un Selection_080.png de
/// 483x72 — el nombre que le pone GNOME a una captura de pantalla recortada.
/// Alguien subio un recorte de screenshot como foto de producto.
const MIN_IMAGE_SIDE = 200;

/// A partir de esta proporcion (lado mayor / lado menor) la foto se considera
/// deforme para un contenedor cuadrado.
///
/// NO se filtra por esto: se cambia el encuadre a object-contain en la card
/// (ver ProductCardImage). Filtrar una foto real por ser angosta es tirar
/// producto vendible — "Destornillador" es 209x1514 y es una foto legitima de
/// un objeto largo.
export const EXTREME_ASPECT_RATIO = 2.5;

export type ImageVerdict = "ok" | "deforme" | "chica" | "rota";

export interface ImageProbe {
  verdict: ImageVerdict;
  width: number;
  height: number;
}

/// Mide una imagen para decidir si sirve como foto de producto.
///
/// Hace falta bajarla: el problema no se ve en la URL. Hay tres modos de
/// fallo distintos y ninguno se detecta mirando el string —
///   - missing.png, que si se filtra por nombre (ver isUsableImage)
///   - imagenes que devuelven algo que no es una imagen (4 de 178 portadas)
///   - screenshots y recortes con proporciones absurdas (22 de 178)
///
/// Se pide solo el primer tramo del archivo: el header con las dimensiones
/// esta al principio. Si con eso no alcanza, se baja entero.
export async function probeImage(url: string): Promise<ImageProbe> {
  const sharp = (await import("sharp")).default;

  async function medir(headersExtra?: Record<string, string>) {
    const res = await fetch(url, { headers: headersExtra });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0 };
  }

  let dims: { width: number; height: number };
  try {
    dims = await medir({ Range: "bytes=0-65535" });
    if (!dims.width || !dims.height) dims = await medir();
  } catch {
    try {
      dims = await medir();
    } catch {
      return { verdict: "rota", width: 0, height: 0 };
    }
  }

  const { width, height } = dims;
  if (!width || !height) return { verdict: "rota", width, height };
  if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE) {
    return { verdict: "chica", width, height };
  }
  if (Math.max(width / height, height / width) > EXTREME_ASPECT_RATIO) {
    return { verdict: "deforme", width, height };
  }
  return { verdict: "ok", width, height };
}

/// Una imagen entra al catalogo salvo que sea rota o demasiado chica. Las
/// deformes SI entran: se les cambia el encuadre, no se descartan.
export function probeAceptada(probe: ImageProbe | undefined): boolean {
  if (!probe) return true; // sin medicion, no se descarta nada
  return probe.verdict === "ok" || probe.verdict === "deforme";
}

/// true si el producto no tiene NI UNA imagen usable en ninguna variante.
///
/// Se importan igual pero con active: false. Un producto sin foto en una
/// tienda de merch no sirve — nadie cotiza lo que no puede ver, y en el
/// catalogo se veria como un cuadrado gris. Como el sync los vuelve a evaluar
/// en cada corrida, si CDO les carga la foto se reactivan solos.
export function hasNoUsableImages(
  product: CdoProduct,
  probes?: Map<string, ImageProbe>
): boolean {
  return (product.variants ?? []).every(
    (variant) => variantImageUrls(variant, probes).length === 0
  );
}

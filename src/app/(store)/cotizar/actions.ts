"use server";

import { QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeSellPrice, getPricingConfig } from "@/lib/pricing";
import { formatPriceArs } from "@/lib/format";
import { getVariantAvailableStock } from "@/lib/product";
import {
  QUOTE_LOGO_EXTENSIONS,
  saveUploadedFile,
  UploadValidationError,
} from "@/lib/storage";

export interface QuoteCartItemInput {
  productId: string;
  variantSku?: string;
  quantity: number;
}

// Topes de la entrada publica. Las dos acciones de este archivo las puede
// invocar cualquiera que conozca el endpoint (una Server Action ES un
// endpoint): nada de lo que llega se considera bien formado por venir
// "de nuestro formulario".
const MAX_QUOTE_ITEMS = 50;
// Generoso a proposito: pedidos corporativos de miles de unidades existen.
// El tope corta el abuso (números absurdos que inflan la transaccion), no
// al cliente grande.
const MAX_QUANTITY_PER_LINE = 10_000;

/// Valida la forma de los items que llegan del cliente. Devuelve null si la
/// entrada no es un array valido; las lineas individualmente invalidas
/// (cantidad no entera, negativa, cero, o fuera de tope) se descartan.
function sanitizeItems(raw: unknown): QuoteCartItemInput[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_QUOTE_ITEMS) return null;

  const items: QuoteCartItemInput[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { productId, variantSku, quantity } = entry as Record<string, unknown>;
    if (typeof productId !== "string" || productId.length === 0) continue;
    if (variantSku !== undefined && typeof variantSku !== "string") continue;
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY_PER_LINE
    ) {
      continue;
    }
    items.push({ productId, variantSku, quantity });
  }
  return items;
}

/// Nombres de los productos que quedaron afuera de una cotizacion, para
/// avisarle al cliente en pantalla en vez de descartar lineas en silencio.
/// Consulta SIN filtros de active/deletedAt a proposito: es solo lectura del
/// nombre para el aviso — el producto pausado o eliminado tiene nombre, y
/// "un producto" a secas no le dice nada al cliente.
async function getUnavailableNames(productIds: string[]): Promise<string[]> {
  if (productIds.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { name: true },
  });
  const names = rows.map((r) => r.name);
  const notFound = productIds.length - rows.length;
  // Filas que ya no existen fisicamente: no hay nombre que dar.
  for (let i = 0; i < notFound; i++) names.push("un producto eliminado");
  return names;
}

export interface QuoteItemSummary {
  productId: string;
  productName: string;
  imageUrl: string | null;
  variantSku?: string;
  variantLabel: string | null;
  quantity: number;
  unitPriceLabel: string;
  subtotal: number;
  subtotalLabel: string;
  inStock: boolean;
  /** Minimo de personalizacion del proveedor, a nivel PRODUCTO (no por
   * variante) — para agrupar y avisar en /cotizar si la suma de lineas de
   * este producto no lo alcanza. */
  minOrderQuantity: number | null;
}

export interface QuoteSummaryResult {
  items: QuoteItemSummary[];
  /// Nombres de productos del borrador que ya no se pueden cotizar
  /// (pausados o eliminados despues de que el cliente los agrego). La
  /// pantalla los muestra; descartarlos en silencio haria pensar al cliente
  /// que se olvido de agregarlos.
  unavailableNames: string[];
}

/// Resumen de los items del borrador para mostrar en /cotizar. Recalcula
/// el precio ACTUAL desde la base (nunca confia en nada de localStorage).
export async function getQuoteItemsSummary(
  rawItems: QuoteCartItemInput[]
): Promise<QuoteSummaryResult> {
  const items = sanitizeItems(rawItems) ?? [];
  if (items.length === 0) return { items: [], unavailableNames: [] };

  const pricingConfig = await getPricingConfig();
  const productIds = [...new Set(items.map((i) => i.productId))];

  const products = await prisma.product.findMany({
    // Solo productos VIVOS: un producto pausado o eliminado no se cotiza por
    // primera vez. (Las cotizaciones YA enviadas conservan sus items aunque
    // el producto muera despues — eso es el soft delete y no pasa por aca.)
    where: { id: { in: productIds }, active: true, deletedAt: null },
    include: {
      images: {
        where: { variantId: null },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
        take: 1,
      },
      variants: {
        select: {
          sku: true,
          colorName: true,
          sizeName: true,
          stock: true,
          reservedStock: true,
          costPrice: true,
        },
      },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const summaries: QuoteItemSummary[] = [];
  const unavailableIds = new Set<string>();
  for (const item of items) {
    const product = byId.get(item.productId);
    // Quedo afuera del filtro (pausado/eliminado) o no existe: va al aviso.
    if (!product) {
      unavailableIds.add(item.productId);
      continue;
    }

    const variant = product.variants.find((v) => v.sku === item.variantSku);

    // El precio sale de la VARIANTE. Si el carrito trae un sku que ya no
    // existe, se omite la linea en vez de cobrar el precio de otra variante:
    // mostrarle al cliente un precio que no corresponde a lo que eligio es
    // peor que no mostrarle la linea. Va al aviso igual que un producto
    // muerto: para el cliente es lo mismo, "esto ya no esta".
    if (!variant) {
      unavailableIds.add(item.productId);
      continue;
    }

    const sellPrice = computeSellPrice(
      variant.costPrice,
      product.currency,
      pricingConfig
    );
    const unitPrice = Number(sellPrice);
    const subtotal = unitPrice * item.quantity;

    summaries.push({
      productId: product.id,
      productName: product.name,
      imageUrl: product.images[0]?.url ?? null,
      variantSku: item.variantSku,
      variantLabel:
        [variant?.colorName, variant?.sizeName].filter(Boolean).join(" / ") ||
        null,
      quantity: item.quantity,
      unitPriceLabel: formatPriceArs(sellPrice),
      subtotal,
      subtotalLabel: formatPriceArs(subtotal),
      inStock: getVariantAvailableStock(variant) > 0,
      minOrderQuantity: product.minOrderQuantity,
    });
  }

  return {
    items: summaries,
    unavailableNames: await getUnavailableNames([...unavailableIds]),
  };
}

export interface SubmitQuoteResult {
  success: boolean;
  error?: string;
  quoteId?: string;
  /// Productos que quedaron afuera al congelar precios (pausados o
  /// eliminados entre que el cliente armo el pedido y lo envio). La
  /// pantalla de confirmacion los muestra.
  omittedProducts?: string[];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitQuote(
  formData: FormData
): Promise<SubmitQuoteResult> {
  const customerName = String(formData.get("customerName") ?? "").trim();
  const customerEmail = String(formData.get("customerEmail") ?? "").trim();
  const customerPhone =
    String(formData.get("customerPhone") ?? "").trim() || null;
  const companyName = String(formData.get("companyName") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const itemsRaw = String(formData.get("items") ?? "[]");
  const logo = formData.get("logo");

  if (!customerName) {
    return { success: false, error: "Falta el nombre." };
  }
  if (!customerEmail || !EMAIL_REGEX.test(customerEmail)) {
    return { success: false, error: "El email no es válido." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(itemsRaw);
  } catch {
    return {
      success: false,
      error: "No se pudieron leer los productos de la cotización.",
    };
  }

  // La validacion de forma va ANTES de tocar la base o subir el logo: una
  // cantidad negativa, decimal, o un array gigante no tienen que llegar ni
  // a la consulta. sanitizeItems descarta las lineas invalidas y rechaza el
  // array entero si excede el tope.
  if (!Array.isArray(parsed)) {
    return {
      success: false,
      error: "No se pudieron leer los productos de la cotización.",
    };
  }
  const items = sanitizeItems(parsed);
  if (items === null) {
    return {
      success: false,
      error: `La cotización admite hasta ${MAX_QUOTE_ITEMS} productos.`,
    };
  }
  if (items.length === 0) {
    return {
      success: false,
      error: "Agregá al menos un producto antes de enviar.",
    };
  }

  // El logo es opcional: el cliente puede cotizar sin subir el arte todavia.
  let logoUrl: string | null = null;
  if (logo instanceof File && logo.size > 0) {
    try {
      logoUrl = await saveUploadedFile(logo, {
        subdir: "quotes",
        allowedExtensions: QUOTE_LOGO_EXTENSIONS,
      });
    } catch (error) {
      if (error instanceof UploadValidationError) {
        return { success: false, error: error.message };
      }
      throw error;
    }
  }

  // Precio CONGELADO al momento de cotizar: se recalcula server-side desde el
  // costo + margen + cotizacion actuales, nunca se confia en un precio que
  // venga del cliente (pudo haber sido manipulado antes de enviarse).
  //
  // El costo ahora vive en la VARIANTE, asi que la busqueda es por
  // (productId, variantSku) y no solo por producto: dos variantes del mismo
  // producto pueden valer distinto, y cobrar la de al lado seria cobrarle al
  // cliente un precio que nunca vio.
  const pricingConfig = await getPricingConfig();
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    // Solo productos VIVOS: pausado o eliminado no se cotiza por primera
    // vez. Ojo con la distincion: las cotizaciones YA enviadas conservan sus
    // items aunque el producto muera despues (soft delete + bloqueo de FK,
    // verificado) — este filtro solo cubre el momento de CREAR una nueva.
    where: { id: { in: productIds }, active: true, deletedAt: null },
    select: {
      id: true,
      currency: true,
      variants: { select: { sku: true, costPrice: true } },
    },
  });

  const productoPorId = new Map(products.map((p) => [p.id, p]));

  const quoteItemsData = [];
  const omitidos: string[] = [];
  const omitidosIds = new Set<string>();
  for (const item of items) {
    const product = productoPorId.get(item.productId);
    // Pausado, eliminado, o directamente inexistente: no entra.
    if (!product) {
      omitidos.push(`producto ${item.productId} no disponible`);
      omitidosIds.add(item.productId);
      continue;
    }

    // Sin variantSku no hay forma de saber que precio corresponde. Antes esto
    // funcionaba porque el precio era del producto; ahora no: se omite la
    // linea en vez de adivinar.
    const variant = item.variantSku
      ? product.variants.find((v) => v.sku === item.variantSku)
      : product.variants[0];

    if (!variant) {
      omitidos.push(`variante ${item.variantSku} del producto ${item.productId} ya no existe`);
      omitidosIds.add(item.productId);
      continue;
    }

    quoteItemsData.push({
      productId: item.productId,
      variantSku: item.variantSku ?? null,
      quantity: item.quantity,
      unitPrice: computeSellPrice(
        variant.costPrice,
        product.currency,
        pricingConfig
      ),
    });
  }

  // Si se cayo alguna linea queda en el log del server (con ids, para
  // diagnostico) Y se le avisa al cliente en pantalla (con nombres, via
  // omittedProducts): sacarle un item sin decirle nada le haria pensar que
  // se olvido de agregarlo.
  if (omitidos.length > 0) {
    console.warn(
      `[cotizar] Se omitieron ${omitidos.length} linea(s) al congelar precios: ${omitidos.join("; ")}`
    );
  }

  if (quoteItemsData.length === 0) {
    return {
      success: false,
      error: "Ninguno de los productos de la cotización está disponible.",
    };
  }

  const omittedProducts = await getUnavailableNames([...omitidosIds]);

  const quote = await prisma.quote.create({
    data: {
      status: QuoteStatus.SUBMITTED,
      customerName,
      customerEmail,
      customerPhone,
      companyName,
      logoUrl,
      notes,
      items: { create: quoteItemsData },
    },
  });

  return { success: true, quoteId: quote.id, omittedProducts };
}

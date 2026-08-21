"use server";

import { QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeSellPrice, getPricingConfig } from "@/lib/pricing";
import { formatPriceArs } from "@/lib/format";
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

/// Resumen de los items del borrador para mostrar en /cotizar. Recalcula
/// el precio ACTUAL desde la base (nunca confia en nada de localStorage).
export async function getQuoteItemsSummary(
  items: QuoteCartItemInput[]
): Promise<QuoteItemSummary[]> {
  if (items.length === 0) return [];

  const pricingConfig = await getPricingConfig();
  const productIds = [...new Set(items.map((i) => i.productId))];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
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
  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) continue; // producto ya no existe/inactivo: se omite

    const variant = product.variants.find((v) => v.sku === item.variantSku);

    // El precio sale de la VARIANTE. Si el carrito trae un sku que ya no
    // existe, se omite la linea en vez de cobrar el precio de otra variante:
    // mostrarle al cliente un precio que no corresponde a lo que eligio es
    // peor que no mostrarle la linea.
    if (!variant) continue;

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
      inStock: variant ? variant.stock - variant.reservedStock > 0 : true,
      minOrderQuantity: product.minOrderQuantity,
    });
  }

  return summaries;
}

export interface SubmitQuoteResult {
  success: boolean;
  error?: string;
  quoteId?: string;
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

  let items: QuoteCartItemInput[];
  try {
    items = JSON.parse(itemsRaw);
  } catch {
    return {
      success: false,
      error: "No se pudieron leer los productos de la cotización.",
    };
  }
  if (!Array.isArray(items) || items.length === 0) {
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
    where: { id: { in: productIds } },
    select: {
      id: true,
      currency: true,
      variants: { select: { sku: true, costPrice: true } },
    },
  });

  const productoPorId = new Map(products.map((p) => [p.id, p]));

  const quoteItemsData = [];
  const omitidos: string[] = [];
  for (const item of items) {
    const product = productoPorId.get(item.productId);
    if (!product) {
      omitidos.push(`producto ${item.productId} ya no existe`);
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

  // Si se cayo alguna linea, queda en el log del server: el cliente ve la
  // cotizacion sin esa linea y desde el panel se puede entender por que.
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

  return { success: true, quoteId: quote.id };
}

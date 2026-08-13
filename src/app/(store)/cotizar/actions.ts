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
    const sellPrice = computeSellPrice(
      product.costPrice,
      pricingConfig.defaultMarginPercent
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
    return { success: false, error: "El email no es valido." };
  }

  let items: QuoteCartItemInput[];
  try {
    items = JSON.parse(itemsRaw);
  } catch {
    return {
      success: false,
      error: "No se pudieron leer los productos de la cotizacion.",
    };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return {
      success: false,
      error: "Agrega al menos un producto antes de enviar.",
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

  // Precio CONGELADO al momento de cotizar: se recalcula server-side desde
  // costPrice + margen actual, nunca se confia en un precio que venga del
  // cliente (pudo haber sido manipulado antes de enviarse).
  const pricingConfig = await getPricingConfig();
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, costPrice: true },
  });
  const costById = new Map(products.map((p) => [p.id, p.costPrice]));

  const quoteItemsData = [];
  for (const item of items) {
    const costPrice = costById.get(item.productId);
    if (!costPrice) continue; // producto ya no existe: se omite
    quoteItemsData.push({
      productId: item.productId,
      variantSku: item.variantSku ?? null,
      quantity: item.quantity,
      unitPrice: computeSellPrice(costPrice, pricingConfig.defaultMarginPercent),
    });
  }

  if (quoteItemsData.length === 0) {
    return {
      success: false,
      error: "Ninguno de los productos de la cotizacion esta disponible.",
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

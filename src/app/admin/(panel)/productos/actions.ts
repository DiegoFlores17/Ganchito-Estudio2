"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { ProductOrigin } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import {
  PRODUCT_IMAGE_EXTENSIONS,
  saveUploadedFile,
  UploadValidationError,
} from "@/lib/storage";

export interface ProductActionResult {
  success: boolean;
  error?: string;
  productId?: string;
}

interface VariantInput {
  colorName?: string;
  sizeName?: string;
  stock: number;
}

/// Crea o edita un producto manual. Ambos casos comparten la misma logica:
/// si viene "productId" en el formulario, es edicion; si no, alta.
export async function saveProduct(formData: FormData): Promise<ProductActionResult> {
  await requireAdmin();

  const productId = String(formData.get("productId") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const supplierName = String(formData.get("supplierName") ?? "").trim() || null;
  const categoryId = String(formData.get("categoryId") ?? "").trim() || null;
  const costPriceRaw = Number(formData.get("costPrice"));
  const simpleStockRaw = Number(formData.get("simpleStock") ?? 0);

  if (!name) {
    return { success: false, error: "Falta el nombre." };
  }
  if (!Number.isFinite(costPriceRaw) || costPriceRaw <= 0) {
    return { success: false, error: "El precio base tiene que ser mayor a 0." };
  }

  let variants: VariantInput[] = [];
  try {
    variants = JSON.parse(String(formData.get("variants") ?? "[]"));
  } catch {
    return { success: false, error: "No se pudieron leer las variantes." };
  }
  if (!Array.isArray(variants)) variants = [];

  const deleteImageIds = JSON.parse(
    String(formData.get("deleteImageIds") ?? "[]")
  ) as string[];

  // Las fotos se validan y guardan ANTES de la transaccion: si una es
  // invalida, no queremos haber tocado nada en la base todavia.
  const newImageFiles = formData
    .getAll("newImages")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  const savedImageUrls: string[] = [];
  for (const file of newImageFiles) {
    try {
      const url = await saveUploadedFile(file, {
        subdir: "products",
        allowedExtensions: PRODUCT_IMAGE_EXTENSIONS,
      });
      savedImageUrls.push(url);
    } catch (error) {
      if (error instanceof UploadValidationError) {
        return { success: false, error: error.message };
      }
      throw error;
    }
  }

  const productData = {
    origin: ProductOrigin.MANUAL,
    name,
    description,
    supplierName,
    categoryId,
    costPrice: costPriceRaw,
  };

  const product = await prisma.$transaction(async (tx) => {
    const saved = productId
      ? await tx.product.update({ where: { id: productId }, data: productData })
      : await tx.product.create({ data: productData });

    // Variantes: se borran y se recrean. QuoteItem.variantSku es un string
    // libre (no FK), asi que no rompe nada historico. Mantiene esto simple
    // en vez de diffear altas/bajas/ediciones variante por variante.
    await tx.productVariant.deleteMany({ where: { productId: saved.id } });

    if (variants.length > 0) {
      await tx.productVariant.createMany({
        data: variants.map((v) => ({
          productId: saved.id,
          sku: `manual-${randomUUID()}`,
          colorName: v.colorName?.trim() || null,
          sizeName: v.sizeName?.trim() || null,
          stock: Number.isFinite(v.stock) ? Math.max(0, v.stock) : 0,
        })),
      });
    } else {
      // Sin variantes cargadas: UNA variante "default" invisible con el
      // stock simple del formulario, para no romper el catalogo/ficha/
      // cotizacion publicos, que ya asumen al menos una variante por
      // producto para calcular el stock real.
      await tx.productVariant.create({
        data: {
          productId: saved.id,
          sku: `manual-${randomUUID()}`,
          stock: Number.isFinite(simpleStockRaw) ? Math.max(0, simpleStockRaw) : 0,
        },
      });
    }

    if (deleteImageIds.length > 0) {
      await tx.productImage.deleteMany({
        where: { id: { in: deleteImageIds }, productId: saved.id },
      });
    }

    if (savedImageUrls.length > 0) {
      const existingImageCount = await tx.productImage.count({
        where: { productId: saved.id },
      });
      await tx.productImage.createMany({
        data: savedImageUrls.map((url, index) => ({
          productId: saved.id,
          url,
          isMain: existingImageCount === 0 && index === 0,
          sortOrder: existingImageCount + index,
        })),
      });
    }

    return saved;
  });

  revalidatePath("/admin/productos");
  revalidatePath("/catalogo");
  revalidatePath(`/producto/${product.id}`);

  return { success: true, productId: product.id };
}

export async function toggleProductActive(
  productId: string,
  active: boolean
): Promise<ProductActionResult> {
  await requireAdmin();

  const product = await prisma.product.findFirst({
    where: { id: productId, origin: ProductOrigin.MANUAL },
  });
  if (!product) {
    return { success: false, error: "Ese producto no existe." };
  }

  await prisma.product.update({ where: { id: productId }, data: { active } });

  revalidatePath("/admin/productos");
  revalidatePath("/catalogo");
  return { success: true };
}

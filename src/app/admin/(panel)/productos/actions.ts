"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { ProductOrigin } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import { findManualProductForWrite } from "@/lib/admin-products";
import { saveProductImage, UploadValidationError } from "@/lib/storage";

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

// Numeros "limpios" solamente: nada de separadores de miles ni comas. Un
// input tipo="number" de HTML siempre usa "." como separador DECIMAL sin
// importar el idioma — "37.000" tipeado pensando en separador de miles
// argentino se lee como 37 con un Number() a secas, y eso paso una vez sin
// que nadie lo notara. Mejor rechazar en vez de adivinar la intencion.
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;
const INTEGER_PATTERN = /^\d+$/;

/// Devuelve el numero si el string es un decimal positivo "limpio"
/// (maximo 2 decimales, sin separadores de miles), o null si no.
function parsePositiveDecimal(raw: FormDataEntryValue | null): number | null {
  const value = String(raw ?? "").trim();
  if (!DECIMAL_PATTERN.test(value)) return null;
  return Number(value);
}

/// Devuelve el numero si el string es un entero no negativo "limpio", o
/// null si no (nada de puntos, comas, ni signos).
function parseNonNegativeInteger(raw: unknown): number | null {
  const value = String(raw ?? "").trim();
  if (!INTEGER_PATTERN.test(value)) return null;
  return Number(value);
}

const PRICE_FORMAT_ERROR =
  'El precio base no es válido. Escribí el número sin puntos de miles (ej: 37000, no 37.000).';
const STOCK_FORMAT_ERROR =
  "El stock no es válido. Tiene que ser un número entero sin puntos ni comas.";

/// Crea o edita un producto manual. Ambos casos comparten la misma logica:
/// si viene "productId" en el formulario, es edicion; si no, alta.
export async function saveProduct(formData: FormData): Promise<ProductActionResult> {
  await requireAdmin();

  const productId = String(formData.get("productId") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const supplierName = String(formData.get("supplierName") ?? "").trim() || null;
  const categoryId = String(formData.get("categoryId") ?? "").trim() || null;

  if (!name) {
    return { success: false, error: "Falta el nombre." };
  }

  // Editar: confirmar que el producto es MANUAL antes de tocarlo. Sin esto,
  // mandando el id de un producto de Zecat se lo convertia en manual (el
  // update escribe origin: MANUAL), se le borraban y recreaban las variantes,
  // y quedaba con su zecatId intacto — o sea que el proximo sync lo volvia a
  // pisar. Nunca se expuso en la UI, pero la accion lo aceptaba.
  //
  // Va ANTES de subir las imagenes a proposito: si el rechazo llegara despues,
  // los archivos ya estarian en Blob sin ningun producto que los referencie.
  if (productId) {
    const editable = await findManualProductForWrite(productId);
    if (!editable) {
      return {
        success: false,
        error: "Ese producto no existe o no se edita desde el panel.",
      };
    }
  }

  const costPriceRaw = parsePositiveDecimal(formData.get("costPrice"));
  if (costPriceRaw === null || costPriceRaw <= 0) {
    return { success: false, error: PRICE_FORMAT_ERROR };
  }

  let variants: VariantInput[] = [];
  try {
    variants = JSON.parse(String(formData.get("variants") ?? "[]"));
  } catch {
    return { success: false, error: "No se pudieron leer las variantes." };
  }
  if (!Array.isArray(variants)) variants = [];

  // Revalidar el stock ACA, no confiar en lo que ya valido el cliente: cada
  // variante y el stock simple tienen que ser enteros no negativos limpios.
  const validatedVariants: VariantInput[] = [];
  for (const v of variants) {
    const stock = parseNonNegativeInteger(v.stock);
    if (stock === null) {
      return { success: false, error: STOCK_FORMAT_ERROR };
    }
    validatedVariants.push({ ...v, stock });
  }
  variants = validatedVariants;

  let simpleStockRaw = 0;
  if (variants.length === 0) {
    const parsed = parseNonNegativeInteger(formData.get("simpleStock") ?? "0");
    if (parsed === null) {
      return { success: false, error: STOCK_FORMAT_ERROR };
    }
    simpleStockRaw = parsed;
  }

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
      savedImageUrls.push(await saveProductImage(file));
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
      // v.stock ya viene validado (entero no negativo) del bloque de arriba.
      await tx.productVariant.createMany({
        data: variants.map((v) => ({
          productId: saved.id,
          sku: `manual-${randomUUID()}`,
          colorName: v.colorName?.trim() || null,
          sizeName: v.sizeName?.trim() || null,
          stock: v.stock,
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
          stock: simpleStockRaw,
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
  // La home tambien muestra productos (destacados) y quedaba afuera de esta
  // lista: sin esto, un cambio hecho desde el panel se veia en el catalogo
  // pero no en la portada. Ver la nota de revalidate en (store)/page.tsx.
  revalidatePath("/");

  return { success: true, productId: product.id };
}

export async function toggleProductActive(
  productId: string,
  active: boolean
): Promise<ProductActionResult> {
  await requireAdmin();

  // Mismo guard que saveProduct, ahora compartido en vez de repetido.
  const product = await findManualProductForWrite(productId);
  if (!product) {
    return { success: false, error: "Ese producto no existe." };
  }

  await prisma.product.update({ where: { id: productId }, data: { active } });

  revalidatePath("/admin/productos");
  revalidatePath("/catalogo");
  revalidatePath("/");
  return { success: true };
}

/// Baja logica de un producto manual.
///
/// NO borra la fila. QuoteItem la referencia por FK con ON DELETE RESTRICT, y
/// el detalle de cotizacion lee item.product.name — el nombre no se copia al
/// cotizar. Un delete real quedaria bloqueado por la base, y forzarlo con
/// CASCADE destruiria las lineas de cotizaciones historicas.
///
/// Se marca deletedAt Y ademas se apaga `active`. Lo segundo no es redundante:
/// las cuatro consultas publicas ya filtran por active = true — incluido el
/// $queryRaw de la busqueda del catalogo, que es el que siempre se olvida —
/// asi que apagarlo saca el producto de todas las superficies publicas en el
/// mismo momento, sin depender de que todas hayan sumado el filtro nuevo.
export async function deleteProduct(
  productId: string
): Promise<ProductActionResult> {
  await requireAdmin();

  const product = await findManualProductForWrite(productId);
  if (!product) {
    return {
      success: false,
      error: "Ese producto no existe o no se elimina desde el panel.",
    };
  }

  await prisma.product.update({
    where: { id: productId },
    data: { deletedAt: new Date(), active: false },
  });

  revalidatePath("/admin/productos");
  revalidatePath("/catalogo");
  // La ficha tambien: si alguien la tenia en el router cache del cliente,
  // seguiria sirviendose despues de eliminar el producto.
  revalidatePath(`/producto/${productId}`);
  revalidatePath("/");

  return { success: true };
}

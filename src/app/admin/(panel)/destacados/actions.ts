"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import { invalidarCachePublico, TAG } from "@/lib/cache-tags";
import { parsearPesosEnteros } from "@/lib/destacados";

export interface FeaturedActionResult {
  success: boolean;
  error?: string;
}

/// Un campo del rango, con el parseo de destacados.ts ("5.000" es 5000, no 5).
function leerPesos(formData: FormData, campo: string): number | null {
  return parsearPesosEnteros(String(formData.get(campo) ?? ""));
}

const FORMATO = "Escribí pesos enteros, sin decimales: por ejemplo 5000 o 5.000.";

/// Guarda el rango de precio de los destacados automaticos.
///
/// Cualquier ADMIN puede (no solo super admin): no toca margen, IVA ni dolar,
/// que viven en otra tabla a proposito (ver FeaturedConfig en el schema).
export async function updateFeaturedConfig(
  formData: FormData
): Promise<FeaturedActionResult> {
  const admin = await requireAdmin();

  const priceMin = leerPesos(formData, "priceMin");
  const priceMax = leerPesos(formData, "priceMax");

  if (priceMin === null) {
    return { success: false, error: `El precio mínimo no es válido. ${FORMATO}` };
  }
  if (priceMax === null) {
    return { success: false, error: `El precio máximo no es válido. ${FORMATO}` };
  }
  // Igual tampoco: un rango de un solo precio deja la portada casi vacia y
  // casi seguro es un error de tipeo.
  if (priceMin >= priceMax) {
    return {
      success: false,
      error:
        priceMin === priceMax
          ? "El mínimo y el máximo no pueden ser iguales: el rango tiene que dejar lugar a más de un precio."
          : "El mínimo tiene que ser menor que el máximo.",
    };
  }

  await prisma.featuredConfig.upsert({
    where: { id: 1 },
    update: { priceMin, priceMax, updatedBy: admin.email },
    create: { id: 1, priceMin, priceMax, updatedBy: admin.email },
  });

  // Despues de escribir: solo el tag de destacados. No hace falta tocar el
  // catalogo ni los precios, que no cambiaron.
  invalidarCachePublico([TAG.featured]);
  revalidatePath("/admin/destacados");
  revalidatePath("/");
  return { success: true };
}

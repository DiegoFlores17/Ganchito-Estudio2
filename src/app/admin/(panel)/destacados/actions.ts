"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import { invalidarCachePublico, TAG } from "@/lib/cache-tags";
import { parsearPesosEnteros } from "@/lib/destacados";
import {
  buscarProductosParaFijar as buscarEnLaBase,
  fijarProducto,
  moverPosicion,
  soltarPosicion,
  type ResultadoBusqueda,
} from "@/lib/destacados-admin";

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

/// Despues de escribir: solo el tag de destacados (nada de catalogo ni precios
/// cambio) y las dos pantallas que lo muestran. Solo si la escritura se hizo.
function alTerminar(r: FeaturedActionResult): FeaturedActionResult {
  if (r.success) {
    invalidarCachePublico([TAG.featured]);
    revalidatePath("/admin/destacados");
    revalidatePath("/");
  }
  return r;
}

/// Fija un producto en una posicion de la portada. Cualquier ADMIN puede: es
/// una decision editorial, no toca precios.
export async function fijarDestacado(
  productId: string,
  posicion: number
): Promise<FeaturedActionResult> {
  await requireAdmin();
  return alTerminar(await fijarProducto(productId, posicion));
}

/// Devuelve una posicion al automatico.
///
/// Recibe el producto que la tarjeta mostraba: si la posicion ya es de otro
/// (alguien la cambio mientras tanto), no suelta nada.
export async function soltarDestacado(
  posicion: number,
  productId: string
): Promise<FeaturedActionResult> {
  await requireAdmin();
  return alTerminar(await soltarPosicion(posicion, productId));
}

/// Sube o baja un fijado una posicion (intercambia si el vecino tambien esta
/// fijado). Igual que soltar, solo actua si la posicion sigue siendo de `productId`.
export async function moverDestacado(
  posicion: number,
  direccion: "arriba" | "abajo",
  productId: string
): Promise<FeaturedActionResult> {
  await requireAdmin();
  return alTerminar(await moverPosicion(posicion, direccion, productId));
}

/// Busqueda del selector de productos. Solo lee: no invalida nada.
export async function buscarProductosParaFijar(texto: string): Promise<ResultadoBusqueda> {
  await requireAdmin();
  return buscarEnLaBase(texto);
}

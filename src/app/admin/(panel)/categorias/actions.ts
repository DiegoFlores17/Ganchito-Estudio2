"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";

export interface CategoryActionResult {
  success: boolean;
  error?: string;
}

/// Prende o apaga una categoria como opcion de filtro del catalogo publico.
///
/// No toca ningun producto: los de una categoria oculta siguen en el catalogo
/// y en la busqueda. Por eso alcanza con requireAdmin() y no hace falta
/// super admin — es una decision de presentacion, reversible de un click.
export async function toggleCategoryVisible(
  categoryId: string,
  visible: boolean
): Promise<CategoryActionResult> {
  await requireAdmin();

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!category) {
    return { success: false, error: "Esa categoría no existe." };
  }

  await prisma.category.update({
    where: { id: categoryId },
    data: { visible },
  });

  revalidatePath("/admin/categorias");
  // El filtro del catalogo se arma con esta lista.
  revalidatePath("/catalogo");
  return { success: true };
}

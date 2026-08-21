"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";

export interface CategoryActionResult {
  success: boolean;
  error?: string;
}

/// Todo lo que toca el mapeo cambia lo que ve el cliente en el filtro.
function revalidarCatalogo() {
  revalidatePath("/admin/categorias");
  revalidatePath("/catalogo");
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

  revalidarCatalogo();
  return { success: true };
}

/// Slug a partir del nombre, unico a nivel tabla.
async function buildUniqueSlug(name: string): Promise<string | null> {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!base) return null;

  // El slug entra en la URL del catalogo, asi que tiene que ser unico. Si el
  // nombre choca con una categoria de proveedor que ya existe, se desambigua
  // con un sufijo en vez de fallar.
  let slug = base;
  for (let intento = 2; intento <= 50; intento++) {
    const tomado = await prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tomado) return slug;
    slug = `${base}-${intento}`;
  }
  return null;
}

/// Crea una categoria PROPIA: sin ids de proveedor, pensada para ser canonica.
///
/// Es la unica forma de crear categorias a mano — las demas las crean los
/// conectores. El nombre es una decision nuestra y no de los proveedores:
/// podemos querer "Lapiceras y escritura" porque asi lo buscan los clientes,
/// aunque Zecat le diga "Escritura" y CDO tambien.
export async function createOwnCategory(
  formData: FormData
): Promise<CategoryActionResult> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) {
    return { success: false, error: "Poné un nombre de al menos 2 caracteres." };
  }
  if (name.length > 60) {
    return { success: false, error: "El nombre no puede pasar de 60 caracteres." };
  }

  const slug = await buildUniqueSlug(name);
  if (!slug) {
    return {
      success: false,
      error: "Ese nombre no genera una URL válida. Probá con letras y números.",
    };
  }

  await prisma.category.create({ data: { name, slug } });

  revalidarCatalogo();
  return { success: true };
}

/// Marca `categoryId` como alias de `canonicalId`: sus productos pasan a
/// mostrarse bajo la canonica y deja de aparecer sola en el filtro.
///
/// `canonicalId` en null desunifica.
export async function setCategoryCanonical(
  categoryId: string,
  canonicalId: string | null
): Promise<CategoryActionResult> {
  await requireAdmin();

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, _count: { select: { aliases: true } } },
  });
  if (!category) {
    return { success: false, error: "Esa categoría no existe." };
  }

  if (canonicalId === null) {
    await prisma.category.update({
      where: { id: categoryId },
      data: { canonicalId: null },
    });
    revalidarCatalogo();
    return { success: true };
  }

  // Las cuatro validaciones existen porque el filtro del catalogo resuelve UN
  // solo nivel (`category.canonical.slug`). Cualquier cadena o ciclo dejaria
  // productos invisibles en el filtro sin que nada falle ruidosamente.
  if (canonicalId === categoryId) {
    return { success: false, error: "Una categoría no puede ser alias de sí misma." };
  }
  if (category._count.aliases > 0) {
    return {
      success: false,
      error:
        "Esta categoría ya tiene alias apuntándole. Desunificalos antes de convertirla en alias de otra.",
    };
  }

  const canonical = await prisma.category.findUnique({
    where: { id: canonicalId },
    select: {
      id: true,
      canonicalId: true,
      zecatFamilyId: true,
      cdoCategoryId: true,
    },
  });
  if (!canonical) {
    return { success: false, error: "La categoría de destino no existe." };
  }
  if (canonical.canonicalId) {
    return {
      success: false,
      error: "La categoría de destino ya es alias de otra. Elegí una categoría propia.",
    };
  }
  if (canonical.zecatFamilyId || canonical.cdoCategoryId) {
    return {
      success: false,
      error:
        "La categoría de destino tiene que ser propia: si es de un proveedor, el próximo sync puede renombrarla y cambiaría el filtro público.",
    };
  }

  await prisma.category.update({
    where: { id: categoryId },
    data: { canonicalId },
  });

  revalidarCatalogo();
  return { success: true };
}

/// Crea la categoria propia y le cuelga los alias de una sola vez.
///
/// Es el atajo del bloque de sugerencias: el caso tipico es "Zecat Escritura
/// + CDO Escritura", donde hacerlo en tres pasos (crear, unificar, unificar)
/// es puro tramite. Va en una transaccion para no dejar una categoria propia
/// vacia si algo falla en el medio.
export async function unifyIntoNewCategory(
  name: string,
  categoryIds: string[]
): Promise<CategoryActionResult> {
  await requireAdmin();

  const limpio = name.trim();
  if (limpio.length < 2) {
    return { success: false, error: "Poné un nombre de al menos 2 caracteres." };
  }
  if (categoryIds.length === 0) {
    return { success: false, error: "Elegí al menos una categoría para unificar." };
  }

  const miembros = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, _count: { select: { aliases: true } } },
  });
  if (miembros.length !== categoryIds.length) {
    return { success: false, error: "Alguna de las categorías ya no existe." };
  }
  if (miembros.some((m) => m._count.aliases > 0)) {
    return {
      success: false,
      error: "Alguna de las categorías ya tiene alias apuntándole.",
    };
  }

  const slug = await buildUniqueSlug(limpio);
  if (!slug) {
    return {
      success: false,
      error: "Ese nombre no genera una URL válida. Probá con letras y números.",
    };
  }

  await prisma.$transaction(async (tx) => {
    const canonica = await tx.category.create({
      data: { name: limpio, slug },
    });
    await tx.category.updateMany({
      where: { id: { in: categoryIds } },
      data: { canonicalId: canonica.id },
    });
  });

  revalidarCatalogo();
  return { success: true };
}

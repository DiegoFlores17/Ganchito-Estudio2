"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import { getMenuGroups, resolverMenuGroup } from "@/lib/admin-categories";
import { GRUPO_SIN_AGRUPAR, esGrupoReservado } from "@/lib/menu-groups";

export interface CategoryActionResult {
  success: boolean;
  error?: string;
}

/// Todo lo que toca el mapeo cambia lo que ve el cliente en el filtro Y el
/// menu del header, que esta en el layout de TODAS las paginas de la tienda.
function revalidarCatalogo() {
  revalidatePath("/admin/categorias");
  revalidatePath("/catalogo");
  // El layout, no una ruta: el menu vive en el Header y lo ven todas.
  revalidatePath("/", "layout");
}

/// Marca la categoria como REVISADA. Se llama desde toda accion del panel que
/// implique que un humano la miro y decidio algo sobre ella.
///
/// Es lo que saca a una categoria del aviso de "esperando revision". Ojo: se
/// marca aunque la decision haya sido dejarla oculta — justamente esa es la
/// diferencia entre "nadie la miro" y "la miraron y la ocultaron".
async function marcarRevisada(categoryId: string) {
  await prisma.category.update({
    where: { id: categoryId },
    data: { reviewedAt: new Date() },
  });
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
    data: { visible, reviewedAt: new Date() },
  });

  revalidarCatalogo();
  return { success: true };
}

/// Asigna (o saca) el grupo del menu de una categoria.
///
/// El valor llega como texto libre desde un input con datalist: el cliente
/// puede elegir uno existente o escribir uno nuevo. La normalizacion se hace
/// ACA y no en el input — si dependiera de que el usuario elija de la lista,
/// tarde o temprano conviven "Hogar y bebidas" y "hogar y bebidas" como dos
/// grupos distintos, y el menu muestra dos columnas donde deberia haber una.
///
/// Vacio saca la categoria de su grupo: pasa a la fila secundaria del menu,
/// que es el default y no una penalizacion.
export async function setCategoryMenuGroup(
  categoryId: string,
  valor: string | null
): Promise<CategoryActionResult> {
  await requireAdmin();

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!category) {
    return { success: false, error: "Esa categoría no existe." };
  }

  // "Otras" es el encabezado que el front le pone a las categorias SIN grupo.
  // Si se pudiera guardar como grupo real, esas categorias dejarian de tener
  // menuGroup null y se perderia la señal de que falta mapearlas: quedarian
  // escondidas en un cajon con nombre propio en vez de visibles como
  // pendientes.
  if (valor && esGrupoReservado(valor)) {
    return {
      success: false,
      error: `"${GRUPO_SIN_AGRUPAR}" no se puede usar como grupo: es el título que lleva el bloque de las categorías sin agrupar. Dejá el campo vacío y va a aparecer ahí sola.`,
    };
  }

  const existentes = await getMenuGroups();
  const menuGroup = resolverMenuGroup(valor, existentes);

  await prisma.category.update({
    where: { id: categoryId },
    data: { menuGroup, reviewedAt: new Date() },
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
    await marcarRevisada(categoryId);
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
  await marcarRevisada(categoryId);

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

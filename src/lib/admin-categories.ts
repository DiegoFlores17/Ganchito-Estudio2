import { prisma } from "@/lib/prisma";

/// De donde salio la categoria. No es una columna: se deduce de cual de los
/// dos ids externos tiene cargado.
export type CategoryOrigin = "ZECAT" | "CDO" | "PROPIA";

export interface AdminCategoryRow {
  id: string;
  name: string;
  slug: string;
  visible: boolean;
  origin: CategoryOrigin;
  /// Productos vivos de la categoria: los eliminados y los pausados no
  /// cuentan, porque el numero esta para decidir si vale la pena ofrecerla
  /// como filtro. Una categoria con 0 productos visibles no le sirve a nadie.
  productCount: number;
}

function resolveOrigin(category: {
  zecatFamilyId: string | null;
  cdoCategoryId: string | null;
}): CategoryOrigin {
  if (category.zecatFamilyId) return "ZECAT";
  if (category.cdoCategoryId) return "CDO";
  return "PROPIA";
}

/// Todas las categorias con su origen y cuantos productos tienen, para la
/// pantalla de visibilidad del panel.
///
/// Ordenadas por nombre y NO por origen a proposito: los dos proveedores
/// traen categorias que se llaman igual ("Escritura", "Llaveros",
/// "Paraguas", "Tecnologia"). Ordenar por nombre las deja pegadas, que es
/// justo lo que hay que ver para decidir si conviene ocultar una de las dos.
export async function getAdminCategories(): Promise<AdminCategoryRow[]> {
  const categories = await prisma.category.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      visible: true,
      zecatFamilyId: true,
      cdoCategoryId: true,
      _count: {
        select: {
          products: { where: { deletedAt: null, active: true } },
        },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    visible: category.visible,
    origin: resolveOrigin(category),
    productCount: category._count.products,
  }));
}

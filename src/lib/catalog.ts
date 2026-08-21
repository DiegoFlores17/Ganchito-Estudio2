import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const PRODUCTS_PER_PAGE = 24;

interface GetProductsParams {
  page: number;
  categorySlug?: string;
  search?: string;
}

export async function getCategories() {
  return prisma.category.findMany({
    orderBy: { name: "asc" },
  });
}

/// Busca por texto (insensible a mayusculas/minusculas Y a acentos, via la
/// extension unaccent de Postgres) sobre nombre/descripcion de producto,
/// nombre de categoria, y color/talle de variante. Prisma no tiene forma
/// nativa de envolver una columna en unaccent(), por eso $queryRaw ACA
/// (parametrizado, no concatenado) solo para resolver que ids matchean —
/// el resto de la consulta (paginacion, filtro de categoria, relaciones)
/// sigue siendo el query builder normal de Prisma via id: { in: [...] }.
async function searchProductIds(search: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT p.id
    FROM products p
    LEFT JOIN categories c ON c.id = p."categoryId"
    LEFT JOIN product_variants v ON v."productId" = p.id
    WHERE p.active = true
      AND p."deletedAt" IS NULL
      AND (
        unaccent(p.name) ILIKE unaccent(${"%" + search + "%"}) OR
        unaccent(p.description) ILIKE unaccent(${"%" + search + "%"}) OR
        unaccent(c.name) ILIKE unaccent(${"%" + search + "%"}) OR
        unaccent(v."colorName") ILIKE unaccent(${"%" + search + "%"}) OR
        unaccent(v."sizeName") ILIKE unaccent(${"%" + search + "%"})
      )
  `;
  return rows.map((r) => r.id);
}

export async function getProducts({
  page,
  categorySlug,
  search,
}: GetProductsParams) {
  const trimmedSearch = search?.trim();
  const matchedIds = trimmedSearch
    ? await searchProductIds(trimmedSearch)
    : null;

  // Busqueda sin resultados: cortar aca, no tiene sentido pedirle a Prisma
  // un id: { in: [] } (Prisma lo resuelve bien, pero es una vuelta de mas).
  if (matchedIds && matchedIds.length === 0) {
    return { products: [], totalPages: 1, total: 0 };
  }

  // deletedAt va explicito aunque eliminar tambien apague `active`: depender
  // de que las dos banderas se muevan siempre juntas es una suposicion
  // implicita, y este proyecto ya se comio un bug por una de esas.
  const where: Prisma.ProductWhereInput = {
    active: true,
    deletedAt: null,
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    ...(matchedIds ? { id: { in: matchedIds } } : {}),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PRODUCTS_PER_PAGE,
      take: PRODUCTS_PER_PAGE,
      include: {
        images: { where: { isMain: true }, take: 1 },
        // costPrice va aca porque el precio ahora vive en la variante: la
        // card necesita todas para saber si muestra un precio exacto o un
        // "Desde" (ver computePriceRange).
        variants: { select: { stock: true, reservedStock: true, costPrice: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products,
    totalPages: Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE)),
    total,
  };
}

/// Productos destacados para la home. Sin flag "featured" en el modelo
/// (ver PENDIENTES.md): por ahora se toman los ultimos sincronizados con
/// foto principal, que es el criterio mas simple sin agregar campos nuevos.
export async function getFeaturedProducts(take: number) {
  return prisma.product.findMany({
    where: { active: true, deletedAt: null, images: { some: { isMain: true } } },
    orderBy: { lastSyncedAt: "desc" },
    take,
    include: {
      images: { where: { isMain: true }, take: 1 },
      variants: { select: { stock: true, reservedStock: true, costPrice: true } },
    },
  });
}

/// Stock real = stock - reservedStock por variante (nunca el bruto). El
/// producto tiene disponibilidad si ALGUNA variante tiene stock real > 0.
export function hasAvailableStock(
  variants: { stock: number; reservedStock: number }[]
): boolean {
  return variants.some((v) => v.stock - v.reservedStock > 0);
}

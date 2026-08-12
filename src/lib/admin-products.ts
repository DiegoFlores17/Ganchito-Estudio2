import { Prisma, ProductOrigin } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/// Mismo mecanismo que la busqueda del catalogo publico (unaccent + ILIKE
/// via $queryRaw parametrizado, ver lib/catalog.ts), pero acotado a
/// nombre/proveedor/categoria y solo productos MANUAL.
async function searchManualProductIds(search: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT p.id
    FROM products p
    LEFT JOIN categories c ON c.id = p."categoryId"
    WHERE p.origin = 'MANUAL'
      AND (
        unaccent(p.name) ILIKE unaccent(${"%" + search + "%"}) OR
        unaccent(p."supplierName") ILIKE unaccent(${"%" + search + "%"}) OR
        unaccent(c.name) ILIKE unaccent(${"%" + search + "%"})
      )
  `;
  return rows.map((r) => r.id);
}

export async function getManualProducts(search?: string) {
  const trimmedSearch = search?.trim();
  const matchedIds = trimmedSearch
    ? await searchManualProductIds(trimmedSearch)
    : null;

  if (matchedIds && matchedIds.length === 0) return [];

  const where: Prisma.ProductWhereInput = {
    origin: ProductOrigin.MANUAL,
    ...(matchedIds ? { id: { in: matchedIds } } : {}),
  };

  return prisma.product.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { category: true },
  });
}

export async function getManualProductById(id: string) {
  return prisma.product.findFirst({
    where: { id, origin: ProductOrigin.MANUAL },
    include: {
      category: true,
      images: { orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }] },
      variants: { orderBy: { createdAt: "asc" } },
    },
  });
}

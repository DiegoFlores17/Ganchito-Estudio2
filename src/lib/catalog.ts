import { prisma } from "@/lib/prisma";

export const PRODUCTS_PER_PAGE = 24;

interface GetProductsParams {
  page: number;
  categorySlug?: string;
}

export async function getCategories() {
  return prisma.category.findMany({
    orderBy: { name: "asc" },
  });
}

export async function getProducts({ page, categorySlug }: GetProductsParams) {
  const where = {
    active: true,
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PRODUCTS_PER_PAGE,
      take: PRODUCTS_PER_PAGE,
      include: {
        images: { where: { isMain: true }, take: 1 },
        variants: { select: { stock: true, reservedStock: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products,
    totalPages: Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE)),
  };
}

/// Stock real = stock - reservedStock por variante (nunca el bruto). El
/// producto tiene disponibilidad si ALGUNA variante tiene stock real > 0.
export function hasAvailableStock(
  variants: { stock: number; reservedStock: number }[]
): boolean {
  return variants.some((v) => v.stock - v.reservedStock > 0);
}

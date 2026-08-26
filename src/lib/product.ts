import { prisma } from "@/lib/prisma";

export async function getProductById(id: string) {
  return prisma.product.findUnique({
    where: { id, active: true, deletedAt: null },
    include: {
      category: true,
      // Solo fotos del producto en si (no una por cada variante/color: con
      // 50+ variantes eso son cientos de miniaturas, no una galeria).
      images: {
        where: { variantId: null },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
      },
      variants: {
        orderBy: { sku: "asc" },
        select: {
          id: true,
          sku: true,
          colorName: true,
          sizeName: true,
          materialName: true,
          stock: true,
          reservedStock: true,
          active: true,
          // El precio de la ficha cambia segun la variante elegida.
          costPrice: true,
        },
      },
      printingAreas: true,
      printingTypes: true,
      // Caracteristicas del producto (Reciclable, BPA Free, Apto
      // lavavajillas). Hoy solo las traen los productos de CDO: la API de
      // Zecat no las expone como dato (ver HANDOFF).
      attributes: { orderBy: { name: "asc" } },
    },
  });
}

/// Stock real de una variante puntual (nunca el bruto).
export function getVariantAvailableStock(variant: {
  stock: number;
  reservedStock: number;
}): number {
  return Math.max(0, variant.stock - variant.reservedStock);
}

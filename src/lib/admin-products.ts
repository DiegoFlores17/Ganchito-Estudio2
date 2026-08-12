import { ProductOrigin } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function getManualProducts() {
  return prisma.product.findMany({
    where: { origin: ProductOrigin.MANUAL },
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

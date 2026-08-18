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
      AND p."deletedAt" IS NULL
      AND (
        unaccent(p.name) ILIKE unaccent(${"%" + search + "%"}) OR
        unaccent(p."supplierName") ILIKE unaccent(${"%" + search + "%"}) OR
        unaccent(c.name) ILIKE unaccent(${"%" + search + "%"})
      )
  `;
  return rows.map((r) => r.id);
}

/// Guarda unica para TODA accion del panel que escriba sobre un producto.
///
/// El panel solo administra productos MANUAL: los de Zecat los maneja el
/// conector, y pisarlos desde aca los rompe (el sync los vuelve a sobrescribir
/// por zecatId, con las variantes ya borradas de por medio).
///
/// Existe porque cada accion resolvia esto por su cuenta y una se lo olvido:
/// toggleProductActive si verificaba el origin, saveProduct no. Con el chequeo
/// en un solo lugar, la proxima accion que se sume no puede olvidarselo.
///
/// Devuelve null si el producto no existe o no es manual — quien llama decide
/// que mensaje darle al usuario.
export async function findManualProductForWrite(id: string) {
  return prisma.product.findFirst({
    // Un producto ya eliminado tampoco se edita, ni se pausa, ni se vuelve a
    // eliminar: para el panel dejo de existir.
    where: { id, origin: ProductOrigin.MANUAL, deletedAt: null },
    select: { id: true },
  });
}

export async function getManualProducts(search?: string) {
  const trimmedSearch = search?.trim();
  const matchedIds = trimmedSearch
    ? await searchManualProductIds(trimmedSearch)
    : null;

  if (matchedIds && matchedIds.length === 0) return [];

  const where: Prisma.ProductWhereInput = {
    origin: ProductOrigin.MANUAL,
    deletedAt: null,
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
    where: { id, origin: ProductOrigin.MANUAL, deletedAt: null },
    include: {
      category: true,
      images: { orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }] },
      variants: { orderBy: { createdAt: "asc" } },
      // Cuantas cotizaciones lo referencian. Lo usa el aviso de eliminar para
      // decir la verdad de lo que va a pasar en vez de que el admin lo
      // descubra despues: esas cotizaciones lo van a seguir mostrando.
      _count: { select: { quoteItems: true } },
    },
  });
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const PRODUCTS_PER_PAGE = 24;

interface GetProductsParams {
  page: number;
  categorySlug?: string;
  search?: string;
}

/// Categorias que se ofrecen como filtro en el catalogo publico.
///
/// Filtrar por `visible` NO oculta ningun producto: los de una categoria
/// oculta siguen saliendo en la grilla y en la busqueda. Lo unico que se saca
/// es la categoria del selector. Un link directo a
/// /catalogo?categoria={slug} sigue resolviendo, a proposito — asi los tiles
/// de la home no se rompen si alguien oculta una de esas categorias.
export async function getVisibleCategories() {
  return prisma.category.findMany({
    // canonicalId: null saca del selector a las que son ALIAS de otra. Sus
    // productos no desaparecen: se muestran bajo la canonica (ver el filtro
    // de getProducts).
    where: { visible: true, canonicalId: null },
    orderBy: { name: "asc" },
  });
}

/// Un grupo del menu del header, con sus categorias ya ordenadas.
export interface MenuGroup {
  /// null es el grupo de las SUELTAS: las visibles que nadie agrupo. No es un
  /// caso especial sino el default, y por eso tiene su lugar en el menu (la
  /// fila de abajo) en vez de desaparecer.
  name: string | null;
  categories: Array<{ id: string; name: string; slug: string; productCount: number }>;
}

/// El menu de categorias del header.
///
/// Mismo criterio de visibilidad que getVisibleCategories(): solo `visible` y
/// no-alias. Lo que agrega es el agrupamiento y el conteo de productos.
///
/// Va en el header de TODO el sitio, asi que corre una vez por navegacion. Hoy
/// sin cache a proposito: son ~24 filas de una tabla chica contra Neon en
/// gru1, y la alternativa (`use cache` de Next 16) obliga a activar
/// `cacheComponents` en next.config.ts, que cambia el modelo de cache de la
/// aplicacion ENTERA. Ese es un cambio propio, con su propia verificacion, no
/// algo para colar dentro de esta tarea. Queda anotado en PENDIENTES.
///
/// El orden DENTRO de cada grupo es por cantidad de productos descendente:
/// todavia no hay datos de ventas, y la cantidad es la mejor aproximacion
/// disponible a "que le interesa mas al cliente". Entre grupos, el orden es el
/// de GRUPOS_ORDENADOS y las sueltas van siempre al final.
export async function getMenuGroups(): Promise<MenuGroup[]> {
  const categories = await prisma.category.findMany({
    where: { visible: true, canonicalId: null },
    select: {
      id: true,
      name: true,
      slug: true,
      menuGroup: true,
      _count: {
        select: { products: { where: { deletedAt: null, active: true } } },
      },
      // Los productos de los ALIAS cuentan para esta categoria: es lo que el
      // filtro publico muestra cuando el cliente la elige (ver getProducts,
      // que resuelve por categoria O por sus alias).
      //
      // Sin esto el orden es una mentira. Las canonicas son categorias
      // PROPIAS y los productos cuelgan de las de proveedor, asi que casi
      // todas tienen 0 productos propios: ordenar por ese numero deja
      // "Escritura" —con cuatro alias llenos— al fondo de su columna.
      aliases: {
        select: {
          _count: {
            select: { products: { where: { deletedAt: null, active: true } } },
          },
        },
      },
    },
  });

  const porGrupo = new Map<string | null, MenuGroup["categories"]>();
  for (const c of categories) {
    const clave = c.menuGroup ?? null;
    const fila = {
      id: c.id,
      name: c.name,
      slug: c.slug,
      productCount:
        c._count.products +
        c.aliases.reduce((n, a) => n + a._count.products, 0),
    };
    porGrupo.set(clave, [...(porGrupo.get(clave) ?? []), fila]);
  }

  const grupos: MenuGroup[] = [];
  for (const [name, cats] of porGrupo) {
    if (name === null) continue; // las sueltas van al final
    grupos.push({
      name,
      categories: cats.sort((a, b) => b.productCount - a.productCount),
    });
  }
  // Entre grupos, alfabetico: sin un criterio de negocio, el alfabetico es
  // estable y predecible. Un `sortOrder` por grupo se puede agregar despues
  // sin tocar nada de esto.
  grupos.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "es"));

  const sueltas = porGrupo.get(null);
  if (sueltas?.length) {
    grupos.push({
      name: null,
      categories: sueltas.sort((a, b) => b.productCount - a.productCount),
    });
  }

  return grupos;
}

/// TODAS las categorias, visibles y ocultas. Es la que va en los formularios
/// del panel.
///
/// No es lo mismo que getVisibleCategories() y la diferencia importa: si el
/// selector de categoria del formulario de producto filtrara por `visible`,
/// un producto manual ya asignado a una categoria oculta perderia su
/// seleccion al editarlo, en silencio.
export async function getAllCategories() {
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
    // Filtrar por una categoria trae tambien los productos de sus ALIAS: la
    // canonica "Escritura" tiene que devolver los de Zecat Y los de CDO, que
    // en la base siguen colgando de la categoria de su proveedor.
    ...(categorySlug
      ? {
          category: {
            OR: [{ slug: categorySlug }, { canonical: { slug: categorySlug } }],
          },
        }
      : {}),
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
        variants: {
          select: {
            stock: true,
            reservedStock: true,
            costPrice: true,
            // Lo necesita computePriceRange para decidir "Desde $X": dos
            // variantes con el mismo costo pueden valer distinto a partir
            // de 2 unidades si descuentan distinto.
            discountPercent: true,
          },
        },
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
      variants: {
          select: {
            stock: true,
            reservedStock: true,
            costPrice: true,
            // Lo necesita computePriceRange para decidir "Desde $X": dos
            // variantes con el mismo costo pueden valer distinto a partir
            // de 2 unidades si descuentan distinto.
            discountPercent: true,
          },
        },
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

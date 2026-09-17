import { Currency, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  normalizarNombre,
  type CatalogFilterOptions,
  type OpcionFiltro,
} from "@/lib/catalog-params";
import { computeSellPrice, getPricingConfig, sellPriceToCost } from "@/lib/pricing";

export const PRODUCTS_PER_PAGE = 24;

interface GetProductsParams {
  page: number;
  categorySlug?: string;
  search?: string;
  /// Precio de VENTA en pesos, tal como lo ve el cliente.
  priceMin?: number;
  priceMax?: number;
  /// Nombres YA normalizados (ver normalizarNombre). Se expanden a todas las
  /// grafias reales antes de ir a la base.
  colores?: string[];
  tecnicas?: string[];
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

/// El filtro de precio, traducido a una condicion sobre el COSTO.
///
/// El precio de venta se calcula al leer, asi que no existe como columna. En
/// vez de calcular ~950 precios por request (o persistir uno que habria que
/// recalcular cada vez que se mueve el dolar), se invierte el umbral: ver
/// `sellPriceToCost`.
///
/// **La semantica es la del precio que MUESTRA la card**, o sea el minimo entre
/// las variantes (el "Desde $X"):
///
///   - "hasta B"  => existe alguna variante con costo <= B   (`some`)
///   - "desde A"  => NINGUNA variante por debajo de A        (`none`)
///
/// El `none` no es un detalle: con `some(costo >= A)` alcanzaria con que UNA
/// variante cara entre en el rango, y el producto apareceria mostrando un
/// "Desde" por debajo del minimo que el cliente pidio.
///
/// El divisor depende de la moneda del producto (309 en USD, 633 en ARS), por
/// eso el OR de dos ramas en vez de un solo umbral.
async function priceWhere(
  priceMin?: number,
  priceMax?: number
): Promise<Prisma.ProductWhereInput> {
  if (priceMin === undefined && priceMax === undefined) return {};
  const config = await getPricingConfig();

  const rama = (currency: Currency): Prisma.ProductWhereInput | null => {
    const min = priceMin === undefined ? null : sellPriceToCost(priceMin, currency, config);
    const max = priceMax === undefined ? null : sellPriceToCost(priceMax, currency, config);
    // Un divisor invalido (margen -100%, dolar en cero) devuelve null. Se
    // descarta la rama en vez de dejar pasar todo: un filtro que dice estar
    // aplicado y no filtra es peor que uno que no muestra nada.
    if ((priceMin !== undefined && !min) || (priceMax !== undefined && !max)) return null;

    const condiciones: Prisma.ProductWhereInput[] = [{ currency }];
    if (max) condiciones.push({ variants: { some: { costPrice: { lte: max } } } });
    if (min) condiciones.push({ variants: { none: { costPrice: { lt: min } } } });
    return { AND: condiciones };
  };

  const ramas = [rama(Currency.ARS), rama(Currency.USD)].filter(
    (r): r is Prisma.ProductWhereInput => r !== null
  );
  // Sin ninguna rama valida, no devolver {} (seria "sin filtro"): devolver algo
  // que no matchee nada, que es lo que el cliente pidio.
  if (ramas.length === 0) return { id: { in: [] } };
  return { OR: ramas };
}

/// Color y tecnica. Los dos son relaciones, asi que bajan a EXISTS y no
/// generan N+1: una sola consulta con subqueries, no una por producto.
async function facetaWhere(
  colores?: string[],
  tecnicas?: string[]
): Promise<Prisma.ProductWhereInput> {
  const pedidos: Prisma.ProductWhereInput[] = [];

  if (colores?.length) {
    const todos = await grafiasDeColor();
    const grafias = expandirGrafias(colores, todos);
    // Ningun color real matchea lo pedido: no dejar pasar todo.
    if (grafias.length === 0) return { id: { in: [] } };
    // Varios colores son un OR entre si (azul O negro), no un AND: pedir un
    // producto que venga en los dos a la vez no es lo que significa marcar
    // dos chips.
    pedidos.push({ variants: { some: { colorName: { in: grafias } } } });
  }

  if (tecnicas?.length) {
    const todas = await grafiasDeTecnica();
    const grafias = expandirGrafias(tecnicas, todas);
    if (grafias.length === 0) return { id: { in: [] } };
    pedidos.push({ printingTypes: { some: { name: { in: grafias } } } });
  }

  // Entre facetas distintas si es AND: color azul Y tecnica sublimacion.
  return pedidos.length ? { AND: pedidos } : {};
}

/// Expande nombres normalizados a todas las grafias reales de la base.
///
/// El filtro guarda en la URL el nombre normalizado ("sublimacion"), no la
/// grafia: asi el link sigue funcionando el dia que un proveedor agregue una
/// escritura nueva del mismo nombre, y un mismo chip trae los productos de las
/// dos grafias en vez de partirlos.
function expandirGrafias(
  normalizados: string[],
  todas: string[]
): string[] {
  const buscados = new Set(normalizados);
  return todas.filter((g) => buscados.has(normalizarNombre(g)));
}

export async function getProducts({
  page,
  categorySlug,
  search,
  priceMin,
  priceMax,
  colores,
  tecnicas,
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
    ...(await priceWhere(priceMin, priceMax)),
    ...(await facetaWhere(colores, tecnicas)),
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

// ---------------------------------------------------------------------------
//  Opciones de los filtros
// ---------------------------------------------------------------------------

const VIVOS = { active: true, deletedAt: null } as const;

// Re-export por comodidad: quien ya trabaja con catalog.ts no tiene que saber
// que los tipos viven en catalog-params.
export type { CatalogFilterOptions, OpcionFiltro };

/// Percentil que se usa como PISO del placeholder de precio, en vez del minimo
/// absoluto.
///
/// El minimo real sale de un costo de 0,09 USD, que es basura de proveedor: da
/// un precio de venta de ~$200 y no hay nada comprable a ese valor. Un
/// placeholder que promete un piso inexistente desorienta mas de lo que ayuda.
const PERCENTIL_PISO = 0.05;

async function grafiasDeColor(): Promise<string[]> {
  const filas = await prisma.productVariant.findMany({
    where: { product: VIVOS, colorName: { not: null } },
    select: { colorName: true },
    distinct: ["colorName"],
  });
  return filas.map((f) => f.colorName!).filter(Boolean);
}

async function grafiasDeTecnica(): Promise<string[]> {
  const filas = await prisma.productPrintingType.findMany({
    where: { product: VIVOS },
    select: { name: true },
    distinct: ["name"],
  });
  return filas.map((f) => f.name).filter(Boolean);
}

/// Agrupa grafias por nombre normalizado y se queda con la mas frecuente como
/// etiqueta.
function agrupar(
  filas: Array<{ nombre: string; productos: number; hex?: string | null }>
): OpcionFiltro[] {
  const grupos = new Map<string, OpcionFiltro & { _mejor: number }>();
  for (const f of filas) {
    const valor = normalizarNombre(f.nombre);
    if (!valor) continue;
    const previo = grupos.get(valor);
    if (!previo) {
      grupos.set(valor, {
        valor,
        etiqueta: f.nombre.trim(),
        productos: f.productos,
        hex: f.hex ?? undefined,
        _mejor: f.productos,
      });
      continue;
    }
    // Los productos se SUMAN entre grafias: es el punto de agruparlas. Ojo que
    // puede sobrecontar un producto que tenga dos grafias del mismo nombre; es
    // un numero orientativo para ordenar, no un total exacto.
    previo.productos += f.productos;
    previo.hex = previo.hex ?? f.hex ?? undefined;
    if (f.productos > previo._mejor) {
      previo.etiqueta = f.nombre.trim();
      previo._mejor = f.productos;
    }
  }
  // Se descarta `_mejor` (auxiliar para elegir la etiqueta) del objeto que
  // sale: no es parte de OpcionFiltro y viajaria al cliente sin uso.
  return [...grupos.values()]
    .map((g): OpcionFiltro => ({
      valor: g.valor,
      etiqueta: g.etiqueta,
      productos: g.productos,
      hex: g.hex,
    }))
    .sort((a, b) => b.productos - a.productos);
}

/// Todo lo que el panel necesita para dibujarse. Tres consultas agregadas, sin
/// N+1: los conteos los hace Postgres, no un bucle sobre productos.
export async function getCatalogFilterOptions(): Promise<CatalogFilterOptions> {
  const [coloresRaw, tecnicasRaw, config] = await Promise.all([
    // COUNT(DISTINCT producto), no de variantes: un producto con ocho variantes
    // negras cuenta una vez. El conteo de variantes inflaba "Negro" a 604
    // cuando los productos son 449.
    prisma.$queryRaw<{ nombre: string; productos: bigint; hex: string | null }[]>`
      SELECT v."colorName" AS nombre,
             COUNT(DISTINCT p.id) AS productos,
             MAX(v."colorHex") AS hex
      FROM product_variants v
      JOIN products p ON p.id = v."productId"
      WHERE p.active AND p."deletedAt" IS NULL AND v."colorName" IS NOT NULL
      GROUP BY v."colorName"
    `,
    prisma.$queryRaw<{ nombre: string; productos: bigint }[]>`
      SELECT t.name AS nombre, COUNT(DISTINCT p.id) AS productos
      FROM product_printing_types t
      JOIN products p ON p.id = t."productId"
      WHERE p.active AND p."deletedAt" IS NULL
      GROUP BY t.name
    `,
    getPricingConfig(),
  ]);

  const { precioPiso, precioTecho } = await rangoDePrecios(config);

  return {
    colores: agrupar(
      coloresRaw.map((c) => ({ nombre: c.nombre, productos: Number(c.productos), hex: c.hex }))
    ),
    tecnicas: agrupar(
      tecnicasRaw.map((t) => ({ nombre: t.nombre, productos: Number(t.productos) }))
    ),
    precioPiso,
    precioTecho,
  };
}

/// El rango de precios que se muestra como placeholder.
///
/// El piso sale de un PERCENTIL y no del minimo: ver PERCENTIL_PISO. El techo
/// si es el maximo real — ahi no hay basura que distorsione, y prometer menos
/// techo del que existe escondería productos caros que si estan.
async function rangoDePrecios(config: Awaited<ReturnType<typeof getPricingConfig>>) {
  // El precio de venta se calcula al leer, asi que el orden por precio no es
  // el orden por costo cuando hay dos monedas. Se traen los costos por moneda
  // y se convierten en memoria: son ~2700 numeros, una sola consulta.
  const variantes = await prisma.productVariant.findMany({
    where: { product: VIVOS },
    select: { costPrice: true, product: { select: { currency: true } } },
  });

  const precios = variantes
    .map((v) => Number(computeSellPrice(v.costPrice, v.product.currency, config)))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (precios.length === 0) return { precioPiso: 0, precioTecho: 0 };

  const piso = precios[Math.floor(precios.length * PERCENTIL_PISO)] ?? precios[0];
  const techo = precios[precios.length - 1];
  return { precioPiso: redondearAbajo(piso), precioTecho: redondearArriba(techo) };
}

/// Redondeo a una cifra "defendible": el placeholder es una orientacion, no un
/// dato exacto, y "$1.847" invita a creer que ese numero significa algo.
function redondearAbajo(n: number): number {
  const paso = escalon(n);
  return Math.max(0, Math.floor(n / paso) * paso);
}

function redondearArriba(n: number): number {
  const paso = escalon(n);
  return Math.ceil(n / paso) * paso;
}

function escalon(n: number): number {
  if (n < 1_000) return 100;
  if (n < 10_000) return 500;
  if (n < 100_000) return 1_000;
  return 10_000;
}

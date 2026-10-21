import type { PricingConfig, SiteConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cachear } from "@/lib/cache-publico";
import { TAG, tagProducto } from "@/lib/cache-tags";
import {
  getCatalogFilterOptions,
  getFeaturedProducts,
  getMenuGroups,
  getProducts,
  type GetProductsParams,
} from "@/lib/catalog";
import { getHomeCategoryShowcase } from "@/lib/home";
import { getProductById } from "@/lib/product";
import { getPricingConfig } from "@/lib/pricing";
import { getSiteConfig } from "@/lib/site-config";

/// Versiones CACHEADAS de las lecturas publicas de la tienda.
///
/// Los originales (catalog.ts, product.ts, pricing.ts, site-config.ts,
/// home.ts) quedan intactos: la cotizacion y el admin siguen leyendo de la
/// base. Estas funciones son las que usan SOLO las paginas y componentes de
/// la tienda. Ver lib/cache-publico.ts para el porque de la cache y
/// lib/cache-tags.ts para quien invalida que.
///
/// EL PRECIO DE VENTA NO SE CACHEA. Se guardan por separado los costos (con
/// los productos) y la config de precios, y la multiplicacion
/// (costo x margen x dolar) ocurre al renderizar. Asi mover el margen o el
/// dolar invalida solo `pricing` (una fila chica), no todo el catalogo.
///
/// TTL: la red de seguridad de lo que no puede invalidar (consola,
/// migraciones, ediciones a mano en la base). Lo que si puede (panel, crons,
/// sync) invalida al instante por tag.

const HORA = 3600;

/// Marca para distinguir "la fila no existe" de un error real a traves del
/// limite de la cache (que solo deja pasar el mensaje de forma fiable).
const FILA_FALTANTE = "cache-publico: pricingConfig sin fila";

const leerPricingConfig = cachear(
  async (): Promise<PricingConfig> => {
    // SOLO LEE. getPricingConfig() crea la fila si falta, y crear desde un
    // render cacheado es un efecto secundario donde no corresponde; si falta
    // se tira para NO guardar la ausencia en la cache.
    const fila = await prisma.pricingConfig.findUnique({ where: { id: 1 } });
    if (!fila) throw new Error(FILA_FALTANTE);
    return fila;
  },
  { clave: "pricing-config", revalidate: 1 * HORA, tags: () => [TAG.pricing] }
);

/// Config de precios para la tienda. Si la fila todavia no existe (base
/// recien creada) cae al lector original, que la crea.
export async function getPricingConfigPublica(): Promise<PricingConfig> {
  try {
    return await leerPricingConfig();
  } catch (error) {
    if (error instanceof Error && error.message.includes(FILA_FALTANTE)) {
      return getPricingConfig();
    }
    throw error;
  }
}

export const getSiteConfigPublica: () => Promise<SiteConfig> = cachear(getSiteConfig, {
  clave: "site-config",
  revalidate: 24 * HORA,
  tags: () => [TAG.site],
});

export const getMenuGroupsPublico = cachear(getMenuGroups, {
  clave: "menu-groups",
  revalidate: 6 * HORA,
  tags: () => [TAG.menu, TAG.categories],
});

export const getCatalogFilterOptionsPublico = cachear(getCatalogFilterOptions, {
  clave: "catalog-filter-options",
  // Incluye el piso/techo de precio, que depende de la config de precios: mismo
  // TTL que la config (1 h), para que la red de seguridad no sea mas floja que
  // la de lo que lo mueve.
  revalidate: 1 * HORA,
  tags: () => [TAG.catalog, TAG.pricing],
});

/// Argumentos normalizados: el mismo filtro escrito en otro orden (colores
/// "a,b" vs "b,a") es la misma entrada de cache.
interface ArgsNormalizados {
  page: number;
  categorySlug?: string;
  priceMin?: number;
  priceMax?: number;
  colores?: string[];
  tecnicas?: string[];
}

function normalizarArgs(p: GetProductsParams): ArgsNormalizados {
  return {
    page: p.page,
    categorySlug: p.categorySlug || undefined,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    colores: p.colores?.length ? [...new Set(p.colores)].sort() : undefined,
    tecnicas: p.tecnicas?.length ? [...new Set(p.tecnicas)].sort() : undefined,
  };
}

const getProductsCacheado = cachear(
  async (args: ArgsNormalizados) => getProducts(args),
  {
    clave: "products",
    revalidate: 6 * HORA,
    tags: () => [TAG.catalog, TAG.categories],
  }
);

/// Grilla del catalogo. NO se cachea:
/// - la busqueda por texto: la cardinalidad es libre (cada bot escribe lo
///   suyo) y llenaria la cache de entradas de un solo uso;
/// - el filtro de precio (precioMin/precioMax): los valores son arbitrarios, asi
///   que cada combinacion seria una clave nueva sin tope. Ademas traduce el
///   umbral a costo con el margen y el dolar de ESE momento.
export function getProductsPublico(params: GetProductsParams) {
  if (params.search?.trim()) return getProducts(params);
  if (params.priceMin !== undefined || params.priceMax !== undefined) return getProducts(params);
  return getProductsCacheado(normalizarArgs(params));
}

/// Forma de un Product.id: cuid (`@default(cuid())`), 25 caracteres que
/// empiezan con "c" (verificado contra los ~1000 productos locales). El rango
/// {20,30} es holgado a proposito: lo que se busca es descartar basura de
/// bots ANTES de tocar cache o base, no validar el algoritmo del cuid.
const ID_PRODUCTO = /^c[a-z0-9]{20,30}$/;

/// Marca de "la ficha no existe": se tira dentro del lector cacheado para que
/// unstable_cache NO guarde el null (un 404 cacheado 24 h taparia un producto
/// que se reactiva). Mismo criterio que FILA_FALTANTE.
const FICHA_INEXISTENTE = "cache-publico: ficha inexistente";

const leerFicha = cachear(
  async (id: string) => {
    const producto = await getProductById(id);
    if (!producto) throw new Error(FICHA_INEXISTENTE);
    return producto;
  },
  {
    clave: "product-by-id",
    revalidate: 24 * HORA,
    tags: (id: string) => [tagProducto(id), TAG.categories],
  }
);

/// Ficha publica. Un id con forma invalida devuelve null sin tocar la base ni
/// la cache (cada id basura seria una entrada de un solo uso). Un id valido
/// que no existe tambien devuelve null, pero sin guardarse.
export async function getProductByIdPublico(
  id: string
): Promise<Awaited<ReturnType<typeof getProductById>>> {
  if (!ID_PRODUCTO.test(id)) return null;
  try {
    return await leerFicha(id);
  } catch (error) {
    if (error instanceof Error && error.message.includes(FICHA_INEXISTENTE)) return null;
    throw error;
  }
}

export const getFeaturedProductsPublico = cachear(getFeaturedProducts, {
  clave: "featured-products",
  revalidate: 6 * HORA,
  tags: () => [TAG.catalog],
});

export const getHomeCategoryShowcasePublico = cachear(getHomeCategoryShowcase, {
  clave: "home-category-showcase",
  revalidate: 6 * HORA,
  tags: () => [TAG.catalog],
});

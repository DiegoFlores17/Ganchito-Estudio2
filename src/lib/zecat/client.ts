import type {
  ZecatGenericProduct,
  ZecatGenericProductListResponse,
} from "./types";

const PAGE_LIMIT = 25;
const MAX_RETRIES = 2;

function getConfig() {
  const token = process.env.ZECAT_API_TOKEN;
  const baseUrl = process.env.ZECAT_API_URL;

  if (!token) {
    throw new Error(
      "Falta ZECAT_API_TOKEN en las variables de entorno. Cargalo en .env antes de sincronizar."
    );
  }
  if (!baseUrl) {
    throw new Error(
      "Falta ZECAT_API_URL en las variables de entorno (ej: https://api-preprod.zecat.com/v1)."
    );
  }

  return { token, baseUrl: baseUrl.replace(/\/$/, "") };
}

async function fetchJson<T>(path: string): Promise<T> {
  const { token, baseUrl } = getConfig();
  const url = `${baseUrl}${path}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(
          `Zecat respondió ${response.status} ${response.statusText} en ${path}`
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

export async function fetchGenericProductPage(
  page: number
): Promise<ZecatGenericProductListResponse> {
  return fetchJson<ZecatGenericProductListResponse>(
    `/generic_product?page=${page}&limit=${PAGE_LIMIT}`
  );
}

export async function fetchGenericProductDetail(
  id: string | number
): Promise<ZecatGenericProduct> {
  // El detalle viene envuelto en { "generic_product": {...} }, a diferencia
  // del listado y la búsqueda que devuelven los productos planos.
  const { generic_product } = await fetchJson<{
    generic_product: ZecatGenericProduct;
  }>(`/generic_product/${id}`);
  return generic_product;
}

export async function searchGenericProducts(
  name: string
): Promise<ZecatGenericProductListResponse> {
  return fetchJson<ZecatGenericProductListResponse>(
    `/generic_product/autocomplete?name=${encodeURIComponent(name)}`
  );
}

/// Recorre todas las páginas de /generic_product y va entregando cada
/// producto (resumen de listado, sin detalle completo) a medida que llegan.
export async function* iterateAllGenericProducts(): AsyncGenerator<ZecatGenericProduct> {
  const first = await fetchGenericProductPage(1);
  yield* first.generic_products;

  for (let page = 2; page <= first.total_pages; page++) {
    const next = await fetchGenericProductPage(page);
    yield* next.generic_products;
  }
}

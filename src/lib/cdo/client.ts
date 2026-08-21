import type { CdoProduct, CdoProductListResponse } from "./types";

/// Tope real de la API: pedir 250 o 500 devuelve 100 igual (verificado).
const PAGE_SIZE = 100;
const MAX_RETRIES = 2;

function getConfig() {
  const token = process.env.CDO_API_TOKEN;
  const baseUrl = process.env.CDO_API_URL;

  if (!token) {
    throw new Error(
      "Falta CDO_API_TOKEN en las variables de entorno. Cargalo en .env antes de sincronizar."
    );
  }
  if (!baseUrl) {
    throw new Error(
      "Falta CDO_API_URL en las variables de entorno (ej: http://api.argentina.cdo.dev.yellowspot.com.ar/v2)."
    );
  }

  return { token, baseUrl: baseUrl.replace(/\/$/, "") };
}

/// La autenticacion NO esta documentada: la doc oficial solo dice
/// "Authenticated with OAuth" y no aclara nada mas. Se descubrio probando.
///
/// Funcionan dos formas: `?auth_token=<TOKEN>` en la query y el header
/// `X-Auth-Token`. Se usa el header para que el token no quede en URLs, logs
/// ni historiales. Todo lo demas (api_key, Bearer, Basic, X-Api-Key...)
/// devuelve 401 con body vacio y sin WWW-Authenticate.
async function fetchJson<T>(path: string): Promise<T> {
  const { token, baseUrl } = getConfig();
  const url = `${baseUrl}${path}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "X-Auth-Token": token, Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          `CDO respondió ${response.status} ${response.statusText} en ${path}`
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

/// Los parametros de paginacion tampoco estan documentados (la tabla de
/// parametros de /products viene vacia en la doc). Son `page_size` y
/// `page_number`.
///
/// OJO: `per_page` y `page` — los nombres que uno probaria primero — se
/// IGNORAN en silencio: devuelven la pagina 1 con status 200 y sin error.
export async function fetchProductPage(
  pageNumber: number
): Promise<CdoProductListResponse> {
  return fetchJson<CdoProductListResponse>(
    `/products?page_size=${PAGE_SIZE}&page_number=${pageNumber}`
  );
}

/// Recorre todo el catalogo de CDO.
///
/// A diferencia de Zecat, NO hace falta pedir el detalle de cada producto: el
/// objeto del listado es identico byte a byte al que devuelve
/// /products/{code} (verificado sobre 6 productos). Por eso el catalogo
/// completo entra en 3 requests y ~9 segundos, contra los ~572 requests y ~5
/// minutos de Zecat.
export async function* iterateAllProducts(): AsyncGenerator<CdoProduct> {
  let page = 1;

  while (true) {
    const response = await fetchProductPage(page);
    yield* response.products;

    if (!response.meta.pagination.next_page) return;
    page++;
  }
}

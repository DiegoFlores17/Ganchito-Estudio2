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

/// Error HTTP de CDO con el status a mano: un 404 del detalle es la
/// confirmacion de que el producto ya no existe; un 5xx, una falla.
export class CdoHttpError extends Error {
  constructor(
    public status: number,
    statusText: string,
    path: string
  ) {
    super(`CDO respondió ${status} ${statusText} en ${path}`);
    this.name = "CdoHttpError";
  }
}

/// Timeout de cada pagina del listado (100 productos, ~1-3 s medidos).
const TIMEOUT_PAGINA_MS = 30_000;
/// Timeout del detalle por code (confirmacion de ausentes).
export const TIMEOUT_DETALLE_MS = 15_000;

/// La autenticacion NO esta documentada: la doc oficial solo dice
/// "Authenticated with OAuth" y no aclara nada mas. Se descubrio probando.
///
/// Funcionan dos formas: `?auth_token=<TOKEN>` en la query y el header
/// `X-Auth-Token`. Se usa el header para que el token no quede en URLs, logs
/// ni historiales. Todo lo demas (api_key, Bearer, Basic, X-Api-Key...)
/// devuelve 401 con body vacio y sin WWW-Authenticate.
async function fetchJson<T>(
  path: string,
  opciones: { timeoutMs?: number; reintentos?: number } = {}
): Promise<T> {
  const { token, baseUrl } = getConfig();
  const url = `${baseUrl}${path}`;
  const reintentos = opciones.reintentos ?? MAX_RETRIES;

  let lastError: unknown;
  for (let attempt = 0; attempt <= reintentos; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "X-Auth-Token": token, Accept: "application/json" },
        ...(opciones.timeoutMs ? { signal: AbortSignal.timeout(opciones.timeoutMs) } : {}),
      });

      if (!response.ok) {
        throw new CdoHttpError(response.status, response.statusText, path);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      // Un 404 no se arregla reintentando: es la respuesta.
      if (error instanceof CdoHttpError && error.status === 404) break;
      if (attempt < reintentos) {
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
  pageNumber: number,
  opciones: { timeoutMs?: number; reintentos?: number } = {}
): Promise<CdoProductListResponse> {
  return fetchJson<CdoProductListResponse>(
    `/products?page_size=${PAGE_SIZE}&page_number=${pageNumber}`,
    opciones
  );
}

/// El catalogo completo, validado contra el total que declara la API. CDO
/// devuelve el producto entero en el listado (identico al detalle,
/// verificado), asi que esto ES el catalogo: ~4 requests.
///
/// Tiene que cerrar (ids distintos == total_count) o tira: una lista
/// incompleta haria aparecer ausentes que no lo son.
export async function listarCatalogoCompleto(): Promise<{
  productos: CdoProduct[];
  total: number;
}> {
  const productos = new Map<string, CdoProduct>();
  let total = 0;
  for (let page = 1; ; page++) {
    const r = await fetchProductPage(page, { timeoutMs: TIMEOUT_PAGINA_MS, reintentos: 1 });
    total = r.meta.pagination.total_count;
    for (const p of r.products) productos.set(String(p.id), p);
    if (!r.meta.pagination.next_page) break;
    if (page > 50) throw new Error("CDO devolvió más de 50 páginas: se corta por las dudas.");
  }
  if (productos.size !== total) {
    throw new Error(
      `La lista de CDO no cierra contra el total declarado: ${productos.size} productos distintos contra ${total}.`
    );
  }
  return { productos: [...productos.values()], total };
}

/// Detalle de un producto por su code (no por id): lo usa la confirmacion de
/// ausentes. 404 = no existe.
export async function fetchProductByCode(code: string): Promise<CdoProduct> {
  return fetchJson<CdoProduct>(`/products/${encodeURIComponent(code)}`, {
    timeoutMs: TIMEOUT_DETALLE_MS,
    reintentos: 0,
  });
}

/// Recorre todo el catalogo de CDO.
///
/// A diferencia de Zecat, NO hace falta pedir el detalle de cada producto: el
/// objeto del listado es identico byte a byte al que devuelve
/// /products/{code} (verificado sobre 6 productos).
export async function* iterateAllProducts(): AsyncGenerator<CdoProduct> {
  let page = 1;

  while (true) {
    const response = await fetchProductPage(page);
    yield* response.products;

    if (!response.meta.pagination.next_page) return;
    page++;
  }
}

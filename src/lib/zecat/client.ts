import type {
  ZecatGenericProduct,
  ZecatGenericProductListResponse,
} from "./types";
import { flattenVariants } from "./normalize";

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

/// Error HTTP de Zecat con el status a mano: quien llama necesita distinguir
/// un 404 (el producto no existe: ausente) de un 5xx (falla: reintentar).
export class ZecatHttpError extends Error {
  constructor(
    public status: number,
    statusText: string,
    path: string
  ) {
    super(`Zecat respondió ${status} ${statusText} en ${path}`);
    this.name = "ZecatHttpError";
  }
}

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
        headers: { Authorization: `Bearer ${token}` },
        ...(opciones.timeoutMs
          ? { signal: AbortSignal.timeout(opciones.timeoutMs) }
          : {}),
      });

      if (!response.ok) {
        throw new ZecatHttpError(response.status, response.statusText, path);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      // Un 404 no se arregla reintentando: es la respuesta.
      if (error instanceof ZecatHttpError && error.status === 404) break;
      if (attempt < reintentos) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

/// Timeout del listado completo de un solo request (limit=1000): medido en
/// 22 s para 582 productos (5,5 MB), asi que 60 s deja margen.
const TIMEOUT_LISTADO_COMPLETO_MS = 60_000;
/// Timeout de cada pagina del listado paginado (limit=100): medido en ~7 s.
const TIMEOUT_PAGINA_MS = 30_000;
/// Timeout del detalle de un producto en el motor del cron.
export const TIMEOUT_DETALLE_MS = 15_000;

/// La lista congelada de una corrida: los ids de TODO el catalogo, y el
/// total que la API dice tener. Se valida que cierren (ids distintos ==
/// total declarado); si no, la lista no sirve para detectar ausentes.
///
/// Primero un solo request con limit=1000 (no esta documentado, pero se
/// midio que funciona): es una foto atomica del listado, sin el riesgo de
/// que se corran las posiciones entre paginas. Si no cierra, se arma
/// paginando de a 100 con la misma validacion. Si tampoco cierra, tira.
export async function listarIdsCongelados(): Promise<{
  ids: string[];
  total: number;
}> {
  const motivos: string[] = [];
  try {
    const r = await fetchJson<ZecatGenericProductListResponse>(
      "/generic_product?page=1&limit=1000",
      { timeoutMs: TIMEOUT_LISTADO_COMPLETO_MS, reintentos: 0 }
    );
    const ids = [...new Set(r.generic_products.map((p) => String(p.id)))];
    if (r.count !== undefined && ids.length === r.count && (r.total_pages ?? 1) <= 1) {
      return { ids, total: r.count };
    }
    motivos.push(`un solo request trajo ${ids.length} ids contra ${r.count} declarados`);
  } catch (error) {
    motivos.push(`un solo request fallo: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Fallback: paginado de a 100, con la misma validacion.
  // Sin reintentos: el tick tiene 120 s en total, y 30 s por pagina con
  // reintentos podria pasarse (la funcion moriria con el lease tomado).
  const primera = await fetchJson<ZecatGenericProductListResponse>(
    "/generic_product?page=1&limit=100",
    { timeoutMs: TIMEOUT_PAGINA_MS, reintentos: 0 }
  );
  const vistos = new Set(primera.generic_products.map((p) => String(p.id)));
  for (let page = 2; page <= (primera.total_pages ?? 1); page++) {
    const r = await fetchJson<ZecatGenericProductListResponse>(
      `/generic_product?page=${page}&limit=100`,
      { timeoutMs: TIMEOUT_PAGINA_MS, reintentos: 0 }
    );
    for (const p of r.generic_products) vistos.add(String(p.id));
  }
  if (primera.count !== undefined && vistos.size === primera.count) {
    console.warn(`[zecat] Lista congelada armada paginando (${motivos.join("; ")}).`);
    return { ids: [...vistos], total: primera.count };
  }
  throw new Error(
    `La lista de Zecat no cierra contra el total declarado: ${vistos.size} ids paginando contra ${primera.count} declarados (${motivos.join("; ")}).`
  );
}

export async function fetchGenericProductPage(
  page: number,
  limit: number = PAGE_LIMIT
): Promise<ZecatGenericProductListResponse> {
  return fetchJson<ZecatGenericProductListResponse>(
    `/generic_product?page=${page}&limit=${limit}`
  );
}

export async function fetchGenericProductDetail(
  id: string | number,
  opciones: { timeoutMs?: number; reintentos?: number } = {}
): Promise<ZecatGenericProduct> {
  // El detalle viene envuelto en { "generic_product": {...} }, a diferencia
  // del listado y la búsqueda que devuelven los productos planos.
  const { generic_product } = await fetchJson<{
    generic_product: ZecatGenericProduct;
  }>(`/generic_product/${id}`, opciones);
  if (!generic_product) {
    throw new Error(`Zecat respondió sin el detalle del producto ${id}.`);
  }
  return generic_product;
}

/// Resultado de confirmar un ausente contra el detalle de Zecat.
/// - "baja": Zecat lo confirma (404, despublicado o sin variantes).
/// - "presente": el detalle esta sano; falta del listado por otra razon.
/// - "no-verificado": no hubo respuesta limpia (timeout, 5xx, red, otro
///   status). NO confirma nada: ese producto no se pausa.
export type Confirmacion = "baja" | "presente" | "no-verificado";

/// Lo que devuelve la confirmacion de un ausente, en cualquier conector.
///
/// `causaPermanente`, solo en "no-verificado": la verificacion no puede
/// salir NUNCA, por mas que se reintente (por ejemplo, un producto de CDO
/// sin code guardado). Es la frase corta que ve el admin ("falta el code de
/// CDO"). Sin ella, el no-verificado es transitorio (timeout, 5xx, red): la
/// proxima corrida lo reintenta. Ver sinVerificarPendientes en
/// lib/sync-run.ts.
export interface ResultadoConfirmacion {
  resultado: Confirmacion;
  motivo: string;
  causaPermanente?: string;
}

/// Timeout del detalle al confirmar. Propio y corto: es una pregunta puntual
/// por producto, y un request colgado no puede comerse la invocacion.
const TIMEOUT_CONFIRMACION_MS = 15_000;

/// Pregunta a Zecat por un producto que falto del listado, ANTES de pausarlo.
///
/// Solo una respuesta limpia confirma la baja. La asimetria es a proposito:
/// pausar por un timeout convertiria una falla de red de Zecat en productos
/// sanos fuera de la tienda; no pausar deja un ausente para la proxima
/// corrida, que lo vuelve a intentar.
///
/// Un solo intento, sin reintentos: lo que no responde limpio queda
/// "no-verificado" y se reintenta en la corrida siguiente, no en esta.
export async function confirmarAusencia(
  id: string
): Promise<ResultadoConfirmacion> {
  try {
    const { token, baseUrl } = getConfig();
    const response = await fetch(`${baseUrl}/generic_product/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_CONFIRMACION_MS),
    });

    if (response.status === 404) {
      return { resultado: "baja", motivo: "Zecat responde que el producto no existe." };
    }
    if (!response.ok) {
      return {
        resultado: "no-verificado",
        motivo: `Zecat respondió ${response.status} ${response.statusText}.`,
      };
    }

    const body = (await response.json()) as { generic_product?: ZecatGenericProduct };
    const detail = body.generic_product;
    if (!detail) {
      return { resultado: "no-verificado", motivo: "Zecat respondió sin el detalle del producto." };
    }
    if (detail.published === false) {
      return { resultado: "baja", motivo: "Zecat lo tiene despublicado." };
    }
    if (!flattenVariants(detail.variants).some((v) => v.active ?? true)) {
      return { resultado: "baja", motivo: "Zecat lo publica sin ninguna variante." };
    }
    return {
      resultado: "presente",
      motivo: "El detalle sigue publicado y con variantes, pero no vino en el listado.",
    };
  } catch (error) {
    const timeout =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      resultado: "no-verificado",
      motivo: timeout
        ? `Zecat no respondió en ${TIMEOUT_CONFIRMACION_MS / 1000} s.`
        : `No se pudo consultar a Zecat: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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

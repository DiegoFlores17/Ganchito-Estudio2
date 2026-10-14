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
  page: number,
  // El sync por batches del panel usa paginas mas chicas (10) para que cada
  // invocacion quede lejos del limite de duracion de Vercel.
  limit: number = PAGE_LIMIT
): Promise<ZecatGenericProductListResponse> {
  return fetchJson<ZecatGenericProductListResponse>(
    `/generic_product?page=${page}&limit=${limit}`
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

/// Resultado de confirmar un ausente contra el detalle de Zecat.
/// - "baja": Zecat lo confirma (404, despublicado o sin variantes).
/// - "presente": el detalle esta sano; falta del listado por otra razon.
/// - "no-verificado": no hubo respuesta limpia (timeout, 5xx, red, otro
///   status). NO confirma nada: ese producto no se pausa.
export type Confirmacion = "baja" | "presente" | "no-verificado";

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
): Promise<{ resultado: Confirmacion; motivo: string }> {
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

import { revalidateTag } from "next/cache";

/// Tags de la cache publica de la tienda (ver lib/lectura-publica.ts).
///
/// Este modulo NO importa `unstable_cache` ni ningun lector cacheado: lo
/// importan los caminos de ESCRITURA (admin, crons, sync) para invalidar, y
/// la cotizacion tiene que poder convivir con el sin acercarse jamas a la
/// cache. La verificacion de scripts/audit-verify-cache.ts prohibe que
/// cotizar/actions.ts o el admin lleguen a lectura-publica.ts o
/// cache-publico.ts.
export const TAG = {
  /// Va en TODA entrada publica: invalida la tienda entera de un golpe.
  store: "store",
  pricing: "pricing",
  site: "site",
  menu: "menu",
  categories: "categories",
  catalog: "catalog",
  /// Rango de precio de los destacados (lo edita el panel).
  featured: "featured",
} as const;

export type TagFijo = (typeof TAG)[keyof typeof TAG];

/// Tag de una ficha de producto. `id` es Product.id (el de la URL).
export function tagProducto(id: string): string {
  return `product:${id}`;
}

/// Gancho de pruebas: si existe `globalThis.__ganchitoCacheRecorder`, cada
/// invalidacion se anota ahi (ya sin duplicados) ademas de intentar el
/// revalidateTag real. Permite que un script verifique QUE tags invalida cada
/// camino de escritura sin levantar Next.
declare global {
  var __ganchitoCacheRecorder: string[][] | undefined;
  /// Sustituto en memoria de unstable_cache para correr los lectores publicos
  /// FUERA de Next (scripts de verificacion). Guarda el JSON, igual que la
  /// cache real, y se purga por tag al invalidar.
  var __ganchitoCacheShim:
    | { entradas: Map<string, { json: string; tags: string[] }>; fallos: number; aciertos: number }
    | undefined;
}

/// Mensaje que tira Next al llamar revalidateTag sin request en curso.
const FUERA_DE_NEXT = "Invariant: static generation store missing";

let avisoFueraDeNext = false;

/// Invalida tags de la cache publica. UNICO punto de invalidacion: todos los
/// caminos de escritura pasan por aca.
///
/// - `expire: 0`: expiracion inmediata. Con "max" (stale-while-revalidate) el
///   primer cliente tras un cambio de precio veria el precio viejo una vez mas.
/// - Se deduplica: Vercel limita las revalidaciones por segundo y por equipo,
///   y un tick del sync puede tocar el mismo tag N veces.
/// - Fuera de Next (scripts de consola que llaman al motor) revalidateTag
///   tira `Invariant: static generation store missing`: es el unico caso
///   benigno. Se ignora y se avisa UNA vez; la tienda se pone al dia por TTL o
///   con "Refrescar tienda" en el panel.
/// - Cada tag se intenta POR SEPARADO: que uno falle no deja a los demas sin
///   invalidar (si cortaba en el primero, un precio nuevo podia quedar
///   cacheado por culpa de un tag anterior). Cualquier otro error se loguea
///   SIEMPRE, con el tag, sin bandera de "una sola vez": un fallo real no tiene
///   que quedar callado despues del primero.
/// - Ojo: los fallos ASINCRONOS (por ejemplo un 429 de Vercel dentro de
///   executeRevalidates) no se ven desde aca, porque revalidateTag no los
///   propaga a este try/catch. El TTL es la red de seguridad.
export function invalidarCachePublico(tags: Iterable<string>): void {
  const unicos = [...new Set(tags)];
  if (unicos.length === 0) return;
  globalThis.__ganchitoCacheRecorder?.push(unicos);
  const shim = globalThis.__ganchitoCacheShim;
  if (shim) {
    for (const [clave, e] of shim.entradas) {
      if (e.tags.some((t) => unicos.includes(t))) shim.entradas.delete(clave);
    }
  }
  for (const tag of unicos) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      if (mensaje.includes(FUERA_DE_NEXT)) {
        if (!avisoFueraDeNext) {
          avisoFueraDeNext = true;
          console.warn(
            `[cache] No se pudo invalidar la cache publica (fuera de Next): ${mensaje}. La tienda se actualiza por TTL o con "Refrescar tienda" en el panel.`
          );
        }
      } else {
        console.error(`[cache] Fallo al invalidar el tag "${tag}": ${mensaje}`);
      }
    }
  }
}

/// Lo que cambio durante un tick del sync, ya clasificado (ver sync/cambios.ts).
export interface CambiosDeTick {
  /// Product.id de cada producto cuya ficha publica cambio.
  productIds: string[];
}

/// Tags de un conjunto de productos cuya ficha publica cambio: su ficha, y si
/// hay al menos uno, tambien el catalogo y el menu (cantidades y grilla).
export function tagsPorProductos(productIds: Iterable<string>): string[] {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return [];
  return [...ids.map(tagProducto), TAG.catalog, TAG.menu];
}

/// Invalida lo que dejo un tick del sync, SEA CUAL SEA su estado final.
export function invalidarPorCambios(cambios: CambiosDeTick | undefined): void {
  if (!cambios) return;
  invalidarCachePublico(tagsPorProductos(cambios.productIds));
}

import { unstable_cache } from "next/cache";
import { rehidratar, serializar } from "@/lib/cache-serializar";
import { TAG } from "@/lib/cache-tags";

/// Cache de las lecturas PUBLICAS de la tienda.
///
/// Por que existe: los bots que recorren /producto/[id] mantenian despierta la
/// base de Neon (scale-to-zero necesita 5 min sin consultas) y cada request de
/// la tienda pegaba a la base sin cache.
///
/// Por que `unstable_cache` y no `use cache`: `use cache` exige activar
/// `cacheComponents`, que cambia el modelo de cache de toda la aplicacion
/// (rompe `export const revalidate` de la home y obliga a Suspense en todos
/// lados), y sin handler remoto es memoria POR INSTANCIA en serverless. En
/// Vercel `unstable_cache` usa el Data Cache regional compartido, que
/// persiste entre deploys.
///
/// REGLA: este modulo y lectura-publica.ts los usa SOLO la tienda. La
/// cotizacion (cotizar/actions.ts) y el admin leen siempre de la base: un
/// precio congelado o un formulario de edicion jamas pueden salir de una
/// cache. Lo verifica scripts/audit-verify-cache.ts.

/// Version MANUAL de la forma de lo que se guarda. unstable_cache arma su clave
/// con fn.toString() + keyParts + argumentos, y la funcion que se le pasa aca
/// (`serializado`) es siempre el mismo closure generico: su texto NO cambia
/// cuando alguien edita el `select`/`include` de un lector. Sin esto, tras un
/// deploy el Data Cache (que persiste entre deploys) seguiria sirviendo
/// entradas con la forma vieja. REGLA: si cambia la forma de lo que devuelve
/// cualquier lector cacheado, subir este numero.
const VERSION_FORMA = "2";

/// Envuelve un lector: lo guarda serializado (Decimal y Date sobreviven) y lo
/// devuelve rehidratado. Los tags pueden depender de los argumentos (la ficha
/// de producto, el filtro de precio), por eso la entrada se arma por llamada.
export function cachear<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
  { clave, revalidate, tags }: { clave: string; revalidate: number; tags: (...args: A) => string[] }
): (...args: A) => Promise<T> {
  const serializado = async (...args: A) => serializar(await fn(...args));

  return async (...args: A): Promise<T> => {
    const tagsDeEsta = [...new Set([TAG.store, ...tags(...args)])];
    const shim = globalThis.__ganchitoCacheShim;
    if (shim) {
      const llave = `${clave}:${JSON.stringify(args)}`;
      const guardada = shim.entradas.get(llave);
      if (guardada) {
        shim.aciertos++;
        return rehidratar<T>(JSON.parse(guardada.json));
      }
      shim.fallos++;
      const json = JSON.stringify(await serializado(...args));
      shim.entradas.set(llave, { json, tags: tagsDeEsta });
      return rehidratar<T>(JSON.parse(json));
    }
    const cacheada = unstable_cache(serializado, ["publico", VERSION_FORMA, clave], {
      tags: tagsDeEsta,
      revalidate,
    });
    return rehidratar<T>(await cacheada(...args));
  };
}

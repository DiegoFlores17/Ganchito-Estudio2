import { prisma } from "@/lib/prisma";
import { probeImage, type ImageProbe, type ImageVerdict } from "./normalize";

export interface ResultadoMedicion {
  /// Veredicto de cada URL que tiene uno (medido ahora o de la cache).
  probes: Map<string, ImageProbe>;
  /// URLs que no se pudieron medir y nunca se habian medido.
  sinMedir: Set<string>;
  medidas: number;
  deCache: number;
  /// Mediciones sin respuesta definitiva en esta llamada (con o sin
  /// veredicto anterior).
  fallidas: number;
}

const desdeCache = (g: { verdict: string; width: number; height: number }): ImageProbe => ({
  verdict: g.verdict as ImageVerdict,
  width: g.width,
  height: g.height,
});

/// Mediciones de imagenes con cache (tabla image_probes). Medir es bajar la
/// imagen: con ~600 URLs era casi todo el tiempo de una corrida de CDO. Con
/// la cache, en una corrida normal solo se mide lo nuevo.
///
/// Que se vuelve a medir:
/// - lo que nunca se midio;
/// - las "rotas", en CADA corrida: pueden haberse arreglado (o haber sido un
///   timeout), y sin foto el producto queda inactivo;
/// - el resto, cada 30 dias: el proveedor puede reemplazar la foto
///   conservando la URL.
///
/// Una medicion "sin-medir" (timeout, 5xx, red) NO se guarda: si la imagen
/// tenia un veredicto anterior se sigue usando ese, y si nunca se midio
/// queda en `sinMedir` (el producto conserva su estado) y se reintenta en la
/// proxima corrida.
///
/// Excepcion: un "rota" anterior NO se reusa. Se vuelve a medir justamente
/// porque puede estar viejo, y reusarlo apagaria un producto sin evidencia
/// de ESTA corrida — por ejemplo uno retenido por el tope, cuyas fotos
/// quedaron como rotas, en la corrida siguiente con la CDN lenta. Cuenta
/// como "sin medir": para un producto que ya estaba apagado por eso, el
/// resultado es el mismo (conserva su estado, o sea, apagado).

export const REMEDIR_CADA_MS = 30 * 24 * 60 * 60 * 1000;
/// De a cuantas se miden en paralelo (cada una con su plazo de 10 s). 12 es
/// lo que ya usaba la corrida vieja de CDO contra su CloudFront sin
/// problemas; con 6, la primera corrida (cache vacia, ~23 imagenes por
/// producto, ~8.000 URLs) iba a tardar aproximadamente el doble (estimado de
/// la primera corrida en local: 945 mediciones en los primeros 40 productos).
const EN_PARALELO = 12;

export async function medirConCache(
  urls: string[],
  ahora: Date = new Date()
): Promise<ResultadoMedicion> {
  const unicas = [...new Set(urls)];
  const probes = new Map<string, ImageProbe>();
  const sinMedir = new Set<string>();
  if (unicas.length === 0) return { probes, sinMedir, medidas: 0, deCache: 0, fallidas: 0 };

  const guardadas = await prisma.imageProbe.findMany({ where: { url: { in: unicas } } });
  const porUrl = new Map(guardadas.map((g) => [g.url, g]));

  const aMedir: string[] = [];
  for (const url of unicas) {
    const g = porUrl.get(url);
    const vencida = g && ahora.getTime() - g.checkedAt.getTime() > REMEDIR_CADA_MS;
    if (!g || g.verdict === "rota" || vencida) aMedir.push(url);
    else probes.set(url, desdeCache(g));
  }

  let fallidas = 0;
  for (let i = 0; i < aMedir.length; i += EN_PARALELO) {
    const tanda = aMedir.slice(i, i + EN_PARALELO);
    const medidas = await Promise.all(tanda.map((url) => probeImage(url)));
    const nuevas: Array<{ url: string; m: ImageProbe }> = [];
    tanda.forEach((url, j) => {
      const m = medidas[j];
      if (m.verdict === "sin-medir") {
        fallidas++;
        const anterior = porUrl.get(url);
        if (anterior && anterior.verdict !== "rota") probes.set(url, desdeCache(anterior));
        else sinMedir.add(url);
        return;
      }
      probes.set(url, m);
      nuevas.push({ url, m });
    });
    // Guardar en la cache es una optimizacion: si falla, el producto se
    // sincroniza igual con lo medido (y en la proxima corrida se mide de nuevo).
    try {
      await Promise.all(
        nuevas.map(({ url, m }) =>
          prisma.imageProbe.upsert({
            where: { url },
            update: { width: m.width, height: m.height, verdict: m.verdict, checkedAt: ahora },
            create: { url, width: m.width, height: m.height, verdict: m.verdict, checkedAt: ahora },
          })
        )
      );
    } catch (error) {
      console.warn(`[cdo-imagenes] No se pudo guardar la cache de ${nuevas.length} medicion(es): ${error instanceof Error ? error.message : error}`);
    }
  }

  return { probes, sinMedir, medidas: aMedir.length, deCache: unicas.length - aMedir.length, fallidas };
}

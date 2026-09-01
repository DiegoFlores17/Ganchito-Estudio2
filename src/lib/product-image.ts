/// Decide si una imagen pasa por el optimizador de Next/Vercel o se sirve
/// directa desde su CDN de origen.
///
/// Contexto (2026-09-01): la cuota de Image Optimization del plan Hobby
/// (5K transformaciones/mes) se agoto y el optimizador devolvia 402
/// (OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED) para toda transformacion
/// nueva — los productos recien sincronizados se veian SIN imagen mientras
/// los viejos vivian del cache edge. Con 13.6K imagenes de proveedor y
/// varios anchos por <Image> (srcset), la cuota no alcanza ni para una
/// pasada de un crawler.
///
/// La regla: las imagenes de PROVEEDOR (Zecat/CDO) ya vienen en webp desde
/// su propio CDN — el optimizador les agrega poco — asi que van directas
/// (`unoptimized`). Las PROPIAS (subidas desde el panel a Vercel Blob) si
/// se optimizan: no vienen pre-optimizadas y son pocas.
///
/// El costo de servir directo: se pierde el srcset (mobile baja la imagen
/// entera). Es un PUENTE hasta que el plan Pro este activo — ahi se evalua
/// revertirlo para recuperar el resize por dispositivo.
export function isOptimizableImage(url: string): boolean {
  return url.includes(".public.blob.vercel-storage.com");
}

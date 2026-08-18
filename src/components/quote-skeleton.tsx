import { Skeleton } from "@/components/skeleton";

/// Skeleton de /cotizar.
///
/// Se usa en dos lugares distintos porque hay DOS esperas encadenadas:
/// 1. loading.tsx de la ruta, mientras carga el segmento.
/// 2. dentro de la propia pagina, mientras resuelve getQuoteItemsSummary()
///    en el cliente (el carrito vive en localStorage, asi que esa consulta
///    recien puede arrancar despues de montar).
/// Compartir la pieza evita que las dos esperas se vean distintas.
export function QuoteSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto max-w-4xl px-6 py-12"
    >
      <span className="sr-only">Cargando tu cotización…</span>

      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-4 h-10 w-64" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />

      {/* Lineas del pedido */}
      <div className="mt-10 flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 border-b border-foreground/10 pb-4"
          >
            <Skeleton className="h-20 w-20 shrink-0 rounded-lg" />
            <div className="flex-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>

      {/* Datos de contacto */}
      <div className="mt-10 flex flex-col gap-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        ))}
        <Skeleton className="h-12 w-full rounded-full" />
      </div>
    </div>
  );
}

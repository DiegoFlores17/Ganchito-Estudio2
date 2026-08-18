import { Skeleton } from "@/components/skeleton";

/// Fallback de la ficha de producto mientras se resuelven el producto y la
/// configuracion de precios.
///
/// A diferencia del catalogo, aca casi todo depende de la base (nombre,
/// descripcion, fotos, variantes), asi que va en gris. Lo unico literal es el
/// "volver al catalogo": el texto es siempre el mismo, solo cambia el href
/// segun el filtro de origen, y mostrarlo da un punto de referencia estable
/// mientras carga el resto.
export default function ProductoLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto max-w-6xl px-6 py-12"
    >
      <span className="sr-only">Cargando el producto…</span>

      <p className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground/40">
        ← Volver al catálogo
      </p>

      {/* Categoria */}
      <Skeleton className="mt-3 h-4 w-32" />

      <div className="mt-4 grid grid-cols-1 gap-12 lg:grid-cols-2">
        {/* Galeria: imagen principal + miniaturas */}
        <div className="flex flex-col gap-3">
          <Skeleton className="aspect-square w-full rounded-2xl" />
          <div className="flex gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="aspect-square w-16 rounded-lg" />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-8">
          {/* Nombre y descripcion */}
          <div>
            <Skeleton className="h-10 w-4/5" />
            <Skeleton className="mt-3 h-10 w-2/5" />
            <div className="mt-6">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-3/4" />
            </div>
          </div>

          {/* Panel de compra: precio, selectores de variante, cantidad y CTA */}
          <div className="flex flex-col gap-6">
            <Skeleton className="h-8 w-48" />

            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-16" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-20 rounded-full" />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-16" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-14 rounded-full" />
                ))}
              </div>
            </div>

            <Skeleton className="h-12 w-full rounded-full" />
          </div>

          {/* Informacion de personalizacion */}
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}

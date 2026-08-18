import { AdminPageHeaderSkeleton } from "@/components/admin/admin-skeletons";
import { Skeleton } from "@/components/skeleton";

export default function CotizacionDetalleLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando la cotización…</span>

      <Skeleton className="h-4 w-40" />

      <div className="mt-4">
        <AdminPageHeaderSkeleton />
      </div>

      {/* Datos del cliente y selector de estado */}
      <div className="mt-8 flex flex-wrap items-start justify-between gap-6 rounded-xl border border-foreground/10 bg-background p-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-44 rounded-lg" />
      </div>

      {/* Items pedidos */}
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 rounded-xl border border-foreground/10 bg-background p-4"
          >
            <Skeleton className="h-16 w-16 shrink-0 rounded-lg" />
            <div className="flex-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

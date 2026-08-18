import {
  AdminPageHeaderSkeleton,
  AdminTableSkeleton,
} from "@/components/admin/admin-skeletons";
import { Skeleton } from "@/components/skeleton";

export default function CotizacionesLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando las cotizaciones…</span>

      <AdminPageHeaderSkeleton withSubtitle={false} />

      {/* Filtros: email, estado y boton, en una fila. */}
      <div className="mt-6 flex flex-wrap items-end gap-4">
        <FilterFieldSkeleton width="w-64" />
        <FilterFieldSkeleton width="w-40" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>

      <AdminTableSkeleton rows={8} columns={6} />
    </div>
  );
}

function FilterFieldSkeleton({ width }: { width: string }) {
  return (
    <div className={`flex flex-col gap-1 ${width}`}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-10 w-full rounded-lg" />
    </div>
  );
}

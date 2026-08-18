import {
  AdminPageHeaderSkeleton,
  AdminTableSkeleton,
} from "@/components/admin/admin-skeletons";
import { Skeleton } from "@/components/skeleton";

export default function EquipoLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando el equipo…</span>
      <AdminPageHeaderSkeleton />
      {/* Formulario de alta: es una fila de campos, no una columna. */}
      <Skeleton className="mt-6 h-24 w-full rounded-xl" />
      <AdminTableSkeleton rows={4} columns={5} />
    </div>
  );
}

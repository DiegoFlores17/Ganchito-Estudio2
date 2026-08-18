import {
  AdminPageHeaderSkeleton,
  AdminTableSkeleton,
} from "@/components/admin/admin-skeletons";
import { Skeleton } from "@/components/skeleton";

export default function ProductosLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando los productos…</span>
      <div className="flex items-center justify-between gap-4">
        <AdminPageHeaderSkeleton />
        <Skeleton className="h-10 w-40 shrink-0 rounded-full" />
      </div>
      <Skeleton className="mt-6 h-[42px] w-full max-w-sm rounded-full" />
      <AdminTableSkeleton rows={6} columns={5} />
    </div>
  );
}

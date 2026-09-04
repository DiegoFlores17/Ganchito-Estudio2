import {
  AdminPageHeaderSkeleton,
} from "@/components/admin/admin-skeletons";
import { Skeleton } from "@/components/skeleton";

export default function ProveedoresLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando proveedores…</span>
      <AdminPageHeaderSkeleton />
      <Skeleton className="mt-8 h-24 w-full max-w-2xl rounded-xl" />
      <Skeleton className="mt-10 h-40 w-full max-w-2xl rounded-xl" />
    </div>
  );
}

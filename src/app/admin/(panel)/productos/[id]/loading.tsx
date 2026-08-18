import {
  AdminFormSkeleton,
  AdminPageHeaderSkeleton,
} from "@/components/admin/admin-skeletons";

export default function EditarProductoLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando el producto…</span>
      <AdminPageHeaderSkeleton />
      <AdminFormSkeleton fields={6} />
    </div>
  );
}

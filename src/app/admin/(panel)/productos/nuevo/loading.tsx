import {
  AdminFormSkeleton,
  AdminPageHeaderSkeleton,
} from "@/components/admin/admin-skeletons";

export default function NuevoProductoLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando el formulario…</span>
      <AdminPageHeaderSkeleton />
      <AdminFormSkeleton fields={6} />
    </div>
  );
}

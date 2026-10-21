import {
  AdminFormSkeleton,
  AdminPageHeaderSkeleton,
} from "@/components/admin/admin-skeletons";

export default function DestacadosLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando los destacados…</span>
      <AdminPageHeaderSkeleton />
      <AdminFormSkeleton fields={2} />
    </div>
  );
}

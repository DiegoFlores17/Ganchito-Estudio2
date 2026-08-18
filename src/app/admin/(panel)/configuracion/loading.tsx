import {
  AdminFormSkeleton,
  AdminPageHeaderSkeleton,
} from "@/components/admin/admin-skeletons";

export default function ConfiguracionLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando la configuracion…</span>
      <AdminPageHeaderSkeleton />
      <AdminFormSkeleton fields={2} />
    </div>
  );
}

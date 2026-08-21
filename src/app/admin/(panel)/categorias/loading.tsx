import {
  AdminPageHeaderSkeleton,
  AdminTableSkeleton,
} from "@/components/admin/admin-skeletons";
import { Skeleton } from "@/components/skeleton";

export default function CategoriasLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando las categorías…</span>
      <AdminPageHeaderSkeleton />
      {/* El aviso de "ocultar no oculta productos" ocupa lugar fijo arriba de
          la tabla: sin este bloque, el contenido real salta hacia abajo al
          entrar. */}
      <Skeleton className="mt-6 h-[50px] w-full rounded-xl" />
      <AdminTableSkeleton rows={8} columns={5} />
    </div>
  );
}

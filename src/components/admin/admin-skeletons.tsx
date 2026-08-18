import { Skeleton } from "@/components/skeleton";

/// Piezas de carga compartidas del panel. Casi todas las pantallas del admin
/// son la misma forma —titulo, bajada, y abajo una tabla o un formulario—,
/// asi que se arman con estos dos bloques en vez de repetir el markup en cada
/// loading.tsx.

export function AdminPageHeaderSkeleton({
  withSubtitle = true,
}: {
  withSubtitle?: boolean;
}) {
  return (
    <div>
      <Skeleton className="h-8 w-56" />
      {withSubtitle && <Skeleton className="mt-2 h-4 w-80" />}
    </div>
  );
}

export function AdminTableSkeleton({
  rows = 6,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="mt-8 overflow-hidden rounded-xl border border-foreground/10 bg-background">
      <div className="border-b border-foreground/10 px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, index) => (
            <Skeleton key={index} className="h-3 flex-1" />
          ))}
        </div>
      </div>

      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="border-b border-foreground/5 px-4 py-3 last:border-0"
        >
          <div className="flex gap-4">
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton key={colIndex} className="h-4 flex-1" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminFormSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <div className="mt-6 flex max-w-2xl flex-col gap-6">
      {Array.from({ length: fields }).map((_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ))}
      <Skeleton className="h-11 w-32 rounded-full" />
    </div>
  );
}

import Image from "next/image";
import { requireAdmin } from "@/lib/admin-auth";
import { getFeaturedPreview } from "@/lib/catalog";
import { FEATURED_PRODUCTS_COUNT, fechaArt, type EtapaDestacado } from "@/lib/destacados";
import { formatDateTime, formatPriceArs } from "@/lib/format";
import { isOptimizableImage } from "@/lib/product-image";
import { FeaturedRangeForm } from "@/components/admin/featured-range-form";

const ETAPA: Record<EtapaDestacado, { texto: string; clases: string }> = {
  rango: { texto: "En rango", clases: "bg-primary/10 text-primary" },
  "relleno-precio": {
    texto: "Relleno: fuera de rango",
    clases: "bg-accent/40 text-foreground/80",
  },
  "relleno-categoria": {
    texto: "Relleno: categoría repetida",
    clases: "bg-foreground/10 text-foreground/60",
  },
};

export default async function DestacadosPage() {
  // La autorizacion no puede quedar solo en el layout: ver requireAdmin().
  await requireAdmin();

  // Lee la base, sin cache: el panel tiene que mostrar lo que hay HOY.
  const { config, posiciones, stats } = await getFeaturedPreview(
    FEATURED_PRODUCTS_COUNT,
    fechaArt(new Date())
  );
  const vacias = Math.max(0, FEATURED_PRODUCTS_COUNT - posiciones.length);

  return (
    <div className="flex flex-col gap-12">
      <div>
        <h1 className="text-2xl font-medium text-foreground">Destacados</h1>
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">
          La portada elige sola: una por categoría, dentro del rango de precio,
          con más colores en stock primero. Entre las parecidas rota cada día.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-medium text-foreground">Rango automático</h2>
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">
          Hoy entran{" "}
          <strong className="font-medium text-foreground">
            {stats.productosEnRango}{" "}
            {stats.productosEnRango === 1 ? "producto" : "productos"}
          </strong>{" "}
          de{" "}
          <strong className="font-medium text-foreground">
            {stats.categoriasEnRango}{" "}
            {stats.categoriasEnRango === 1 ? "categoría" : "categorías"}
          </strong>
          .
        </p>
        <div className="mt-4">
          <FeaturedRangeForm priceMin={config.priceMin} priceMax={config.priceMax} />
        </div>
        <p className="mt-3 max-w-md text-xs text-foreground/50">
          {config.esDefault
            ? "Todavía nadie guardó un rango: rigen los valores por defecto."
            : `Última edición: ${config.updatedBy ?? "—"}${
                config.updatedAt ? ` · ${formatDateTime(config.updatedAt)}` : ""
              }`}
        </p>
      </section>

      <section>
        <h2 className="text-lg font-medium text-foreground">Vista previa</h2>
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">
          Las {FEATURED_PRODUCTS_COUNT} posiciones de la portada, en el orden en que se ven,
          según el rango guardado. Los precios son sin IVA.
        </p>
        <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {posiciones.map((p, index) => (
            <li
              key={p.id}
              className="flex gap-3 rounded-xl border border-foreground/10 bg-background p-3"
            >
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-foreground/5">
                {p.imageUrl && (
                  <Image
                    src={p.imageUrl}
                    alt=""
                    fill
                    sizes="80px"
                    unoptimized={!isOptimizableImage(p.imageUrl)}
                    className="object-contain"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-foreground/50">#{index + 1}</p>
                <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                <p className="truncate text-xs text-foreground/60">
                  {p.categoryName ?? "Sin categoría"}
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {formatPriceArs(p.precio)}{" "}
                  <span className="text-xs text-foreground/50">
                    · {p.colores} {p.colores === 1 ? "color" : "colores"}
                  </span>
                </p>
                <span
                  className={`mt-1.5 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${ETAPA[p.etapa].clases}`}
                >
                  {ETAPA[p.etapa].texto}
                </span>
              </div>
            </li>
          ))}
          {Array.from({ length: vacias }).map((_, i) => (
            <li
              key={`vacia-${i}`}
              className="flex items-center rounded-xl border border-dashed border-foreground/15 p-3 text-sm text-foreground/40"
            >
              #{posiciones.length + i + 1} · Sin producto para esta posición
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

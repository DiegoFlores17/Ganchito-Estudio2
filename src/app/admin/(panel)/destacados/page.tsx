import { requireAdmin } from "@/lib/admin-auth";
import { getFeaturedPreview } from "@/lib/catalog";
import { FEATURED_PRODUCTS_COUNT, fechaArt } from "@/lib/destacados";
import { formatDateTime, formatPriceArs } from "@/lib/format";
import { FeaturedRangeForm } from "@/components/admin/featured-range-form";
import { FeaturedPositions, type PosicionVM } from "@/components/admin/featured-positions";

export default async function DestacadosPage() {
  // La autorizacion no puede quedar solo en el layout: ver requireAdmin().
  await requireAdmin();

  // Lee la base, sin cache: el panel tiene que mostrar lo que hay HOY.
  const { config, posiciones, omitidos, stats } = await getFeaturedPreview(
    FEATURED_PRODUCTS_COUNT,
    fechaArt(new Date())
  );
  // Las N posiciones, con o sin producto: la tarjeta de una vacia ofrece
  // elegir uno. Los precios se formatean aca porque un Decimal no cruza al
  // componente de cliente.
  const slots: PosicionVM[] = Array.from({ length: FEATURED_PRODUCTS_COUNT }, (_, i) => {
    const p = posiciones.find((x) => x.posicion === i + 1);
    return {
      posicion: i + 1,
      producto: p
        ? {
            id: p.id,
            name: p.name,
            categoryName: p.categoryName,
            imageUrl: p.imageUrl,
            precioTexto: formatPriceArs(p.precio),
            colores: p.colores,
            origen: p.origen,
            etapa: p.etapa,
            advertencias: p.advertencias,
          }
        : null,
    };
  });

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
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">
          Fijá un producto para que quede siempre en esa posición; el resto lo elige el
          automático.
        </p>
        <FeaturedPositions
          posiciones={slots}
          omitidos={omitidos.map((o) => ({ id: o.id, name: o.name, rank: o.rank, motivo: o.motivo }))}
        />
      </section>
    </div>
  );
}

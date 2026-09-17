import { ActiveFilters } from "@/components/catalog/active-filters";
import { CategoryFilter } from "@/components/catalog/category-filter";
import { FiltersPanel } from "@/components/catalog/filters-panel";
import { Pagination } from "@/components/catalog/pagination";
import { ProductCard } from "@/components/catalog/product-card";
import { SearchInput } from "@/components/search-input";
import {
  getCatalogFilterOptions,
  getMenuGroups,
  getProducts,
  hasAvailableStock,
} from "@/lib/catalog";
import {
  buildCatalogHref,
  hayAlgunFiltro,
  parseCatalogParams,
  type ParamsCrudos,
} from "@/lib/catalog-params";
import { computePriceRange, getPricingConfig } from "@/lib/pricing";

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<ParamsCrudos>;
}) {
  // Un solo lugar parsea la URL y un solo lugar la arma (catalog-params). Cada
  // control tenia su propio armado y preservaba un subconjunto distinto de
  // parametros; con tres filtros mas, el primero que se olvide de uno lo borra
  // en silencio al navegar.
  const filtros = parseCatalogParams(await searchParams);

  const [{ products, totalPages, total }, categoryGroups, opciones, pricingConfig] =
    await Promise.all([
      getProducts({
        page: filtros.page,
        categorySlug: filtros.categoria,
        search: filtros.q,
        priceMin: filtros.precioMin,
        priceMax: filtros.precioMax,
        colores: filtros.colores,
        tecnicas: filtros.tecnicas,
      }),
      getMenuGroups(),
      getCatalogFilterOptions(),
      getPricingConfig(),
    ]);

  const activeCategoryName = categoryGroups
    .flatMap((g) => g.categories)
    .find((c) => c.slug === filtros.categoria)?.name;

  // Se pasa a cada ProductCard para que la ficha de producto pueda armar un
  // "volver al catalogo" que preserve TODO el filtrado, no solo la categoria.
  const catalogQuery =
    buildCatalogHref(filtros, { page: filtros.page }).split("?")[1] || undefined;

  return (
    <div className="mx-auto max-w-6xl px-6 py-14 sm:py-16">
      <header className="max-w-2xl">
        <h1 className="text-5xl font-black tracking-tight text-foreground">
          Catálogo
        </h1>
        <p className="mt-3 text-foreground/70">
          Merch corporativo para personalizar con el logo de tu empresa.
        </p>
      </header>

      <div className="mt-10">
        <SearchInput
          basePath="/catalogo"
          initialValue={filtros.q}
          extraParams={extraParamsDeBusqueda(filtros)}
          placeholder="Buscar productos..."
        />
      </div>

      <div className="mt-4">
        <CategoryFilter
          groups={categoryGroups}
          filtros={filtros}
          opciones={opciones}
          total={total}
        />
      </div>

      <div className="mt-4">
        <FiltersPanel filtros={filtros} opciones={opciones} />
      </div>

      {hayAlgunFiltro(filtros) && (
        <div className="mt-5">
          <ActiveFilters filtros={filtros} opciones={opciones} />
        </div>
      )}

      <p className="mt-6 text-sm text-foreground/50">
        {total} {total === 1 ? "producto" : "productos"}
        {activeCategoryName ? ` en ${activeCategoryName}` : ""}
        {filtros.q ? ` para "${filtros.q}"` : ""}
      </p>

      {products.length === 0 ? (
        <SinResultados hayFiltros={hayAlgunFiltro(filtros)} />
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => {
            const rango = computePriceRange(
              product.variants,
              product.currency,
              pricingConfig
            );
            if (!rango) return null;
            return (
              <ProductCard
                key={product.id}
                product={product}
                sellPrice={rango.min}
                priceVaries={rango.varies}
                inStock={hasAvailableStock(product.variants)}
                catalogQuery={catalogQuery}
              />
            );
          })}
        </div>
      )}

      <div className="mt-20">
        <Pagination currentPage={filtros.page} totalPages={totalPages} filtros={filtros} />
      </div>
    </div>
  );
}

/// Lo que el buscador de texto tiene que preservar al navegar. Va como
/// `Record<string, string | undefined>` porque es la forma que espera
/// SearchInput; las multi-selecciones no entran ahi y por eso ese componente
/// arma su URL con buildCatalogHref (ver su propio comentario).
function extraParamsDeBusqueda(filtros: ReturnType<typeof parseCatalogParams>) {
  return {
    categoria: filtros.categoria,
    precioMin: filtros.precioMin?.toString(),
    precioMax: filtros.precioMax?.toString(),
  };
}

/// Cero resultados.
///
/// No alcanza con "no hay nada": el cliente necesita saber QUE lo dejo sin
/// resultados y poder deshacerlo. Los chips de filtros activos se muestran
/// arriba (ActiveFilters) y siguen siendo la salida; aca solo se explica el
/// estado y se ofrece el catalogo completo.
function SinResultados({ hayFiltros }: { hayFiltros: boolean }) {
  return (
    <div className="mt-16 rounded-2xl border border-foreground/10 bg-foreground/[0.02] px-6 py-14 text-center">
      <p className="text-lg font-medium text-foreground">
        No encontramos productos con esa combinación
      </p>
      {hayFiltros && (
        <>
          <p className="mx-auto mt-2 max-w-md text-sm text-foreground/60">
            Probá sacando alguno de los filtros de arriba. Cada uno tiene una
            cruz para quitarlo de a uno.
          </p>
          <a
            href="/catalogo"
            className="mt-6 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
          >
            Ver todo el catálogo
          </a>
        </>
      )}
    </div>
  );
}

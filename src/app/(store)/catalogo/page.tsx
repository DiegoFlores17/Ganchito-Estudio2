import { CategoryFilter } from "@/components/catalog/category-filter";
import { Pagination } from "@/components/catalog/pagination";
import { ProductCard } from "@/components/catalog/product-card";
import { SearchInput } from "@/components/search-input";
import { getCategories, getProducts, hasAvailableStock } from "@/lib/catalog";
import { computeSellPrice, getPricingConfig } from "@/lib/pricing";

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; categoria?: string; q?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const categorySlug = params.categoria || undefined;
  const search = params.q || undefined;

  const [{ products, totalPages, total }, categories, pricingConfig] =
    await Promise.all([
      getProducts({ page, categorySlug, search }),
      getCategories(),
      getPricingConfig(),
    ]);

  const activeCategoryName = categories.find(
    (c) => c.slug === categorySlug
  )?.name;

  // Se pasa a cada ProductCard para que la ficha de producto pueda armar
  // un "volver al catalogo" que preserve pagina/categoria/busqueda.
  const catalogQueryParams = new URLSearchParams();
  if (categorySlug) catalogQueryParams.set("categoria", categorySlug);
  if (search) catalogQueryParams.set("q", search);
  if (page > 1) catalogQueryParams.set("page", String(page));
  const catalogQuery = catalogQueryParams.size
    ? catalogQueryParams.toString()
    : undefined;

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
          initialValue={search}
          extraParams={{ categoria: categorySlug }}
          placeholder="Buscar productos..."
        />
      </div>

      <div className="mt-4">
        <CategoryFilter
          categories={categories}
          activeSlug={categorySlug}
          search={search}
        />
      </div>

      <p className="mt-6 text-sm text-foreground/50">
        {total} {total === 1 ? "producto" : "productos"}
        {activeCategoryName ? ` en ${activeCategoryName}` : ""}
        {search ? ` para "${search}"` : ""}
      </p>

      {products.length === 0 ? (
        <p className="mt-16 text-foreground/60">
          {search
            ? `No se encontraron productos para "${search}".`
            : "No hay productos en esta categoría."}
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              sellPrice={computeSellPrice(
                product.costPrice,
                pricingConfig.defaultMarginPercent
              )}
              inStock={hasAvailableStock(product.variants)}
              catalogQuery={catalogQuery}
            />
          ))}
        </div>
      )}

      <div className="mt-20">
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          categorySlug={categorySlug}
          search={search}
        />
      </div>
    </div>
  );
}

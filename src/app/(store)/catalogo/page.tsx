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

  const [{ products, totalPages }, categories, pricingConfig] =
    await Promise.all([
      getProducts({ page, categorySlug, search }),
      getCategories(),
      getPricingConfig(),
    ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <header className="max-w-2xl">
        <h1 className="text-4xl font-black tracking-tight text-foreground">
          Catalogo
        </h1>
        <p className="mt-2 text-foreground/70">
          Merch corporativo para personalizar con el logo de tu empresa.
        </p>
      </header>

      <div className="mt-8">
        <SearchInput
          basePath="/catalogo"
          initialValue={search}
          extraParams={{ categoria: categorySlug }}
          placeholder="Buscar productos..."
        />
      </div>

      <div className="mt-6">
        <CategoryFilter
          categories={categories}
          activeSlug={categorySlug}
          search={search}
        />
      </div>

      {products.length === 0 ? (
        <p className="mt-16 text-foreground/60">
          {search
            ? `No se encontraron productos para "${search}".`
            : "No hay productos en esta categoria."}
        </p>
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              sellPrice={computeSellPrice(
                product.costPrice,
                pricingConfig.defaultMarginPercent
              )}
              inStock={hasAvailableStock(product.variants)}
            />
          ))}
        </div>
      )}

      <div className="mt-16">
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

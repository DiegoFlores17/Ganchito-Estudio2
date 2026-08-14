import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { getManualProducts } from "@/lib/admin-products";
import { computeSellPrice, getPricingConfig } from "@/lib/pricing";
import { formatPriceArs } from "@/lib/format";
import { ToggleActiveButton } from "@/components/admin/toggle-active-button";
import { SearchInput } from "@/components/search-input";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // La autorizacion no puede quedar solo en el layout: ver el comentario de
  // requireAdmin() en src/lib/admin-auth.ts.
  await requireAdmin();

  const params = await searchParams;
  const search = params.q || undefined;

  const [products, pricingConfig] = await Promise.all([
    getManualProducts(search),
    getPricingConfig(),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-foreground">
            Productos manuales
          </h1>
          <p className="mt-1 text-sm text-foreground/60">
            Los productos de Zecat no se listan ni se editan aca.
          </p>
        </div>
        <Link
          href="/admin/productos/nuevo"
          className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
        >
          Nuevo producto
        </Link>
      </div>

      <div className="mt-6 max-w-sm">
        <SearchInput
          basePath="/admin/productos"
          initialValue={search}
          placeholder="Buscar por nombre, proveedor o categoria..."
        />
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-foreground/10 bg-background">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-xs text-foreground/50">
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Proveedor</th>
              <th className="px-4 py-3 font-medium">Precio</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const sellPrice = computeSellPrice(
                product.costPrice,
                pricingConfig.defaultMarginPercent
              );
              return (
                <tr
                  key={product.id}
                  className="border-b border-foreground/5 last:border-0"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/productos/${product.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {product.name}
                    </Link>
                    {product.category && (
                      <p className="text-xs text-foreground/50">
                        {product.category.name}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground/70">
                    {product.supplierName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-foreground/70">
                    {formatPriceArs(sellPrice)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "rounded-full px-2.5 py-1 text-xs font-medium " +
                        (product.active
                          ? "bg-primary/10 text-primary"
                          : "bg-foreground/10 text-foreground/50")
                      }
                    >
                      {product.active ? "Activo" : "Pausado"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ToggleActiveButton
                      productId={product.id}
                      active={product.active}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {products.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-foreground/50">
            {search
              ? `No se encontraron productos para "${search}".`
              : "Todavia no cargaste ningun producto manual."}
          </p>
        )}
      </div>
    </div>
  );
}

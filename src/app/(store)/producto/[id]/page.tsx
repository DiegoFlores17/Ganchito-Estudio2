import { notFound } from "next/navigation";
import Link from "next/link";
import { Gallery } from "@/components/product/gallery";
import { PrintingInfo } from "@/components/product/printing-info";
import { ProductAttributes } from "@/components/product/product-attributes";
import { PurchasePanel } from "@/components/product/purchase-panel";
import { getProductById } from "@/lib/product";
import {
  computePriceRange,
  computeSellPrice,
  getPricingConfig,
} from "@/lib/pricing";
import { formatPriceArs } from "@/lib/format";

export default async function ProductoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ desde?: string }>;
}) {
  const { id } = await params;
  const { desde } = await searchParams;

  const [product, pricingConfig] = await Promise.all([
    getProductById(id),
    getPricingConfig(),
  ]);

  if (!product) notFound();

  // El precio se calcula por variante y se manda ya formateado: PurchasePanel
  // es client component y los Decimal de Prisma no cruzan esa frontera.
  const priceBySku: Record<string, string> = {};
  for (const v of product.variants) {
    priceBySku[v.sku] = formatPriceArs(
      computeSellPrice(v.costPrice, product.currency, pricingConfig)
    );
  }

  const rango = computePriceRange(
    product.variants,
    product.currency,
    pricingConfig
  );

  // "desde" trae la pagina/categoria/busqueda que tenia el catalogo cuando
  // el cliente entro a este producto (ver ProductCard) — asi "volver" no
  // lo manda a un catalogo vacio de filtros.
  const backToCatalogHref = desde ? `/catalogo?${desde}` : "/catalogo";

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Link
        href={backToCatalogHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground/60 transition-colors hover:text-primary"
      >
        ← Volver al catálogo
      </Link>

      {product.category && (
        <Link
          href={`/catalogo?categoria=${product.category.slug}`}
          className="mt-3 block text-sm font-medium text-foreground/60 transition-colors hover:text-primary"
        >
          {product.category.name}
        </Link>
      )}

      <div className="mt-4 grid grid-cols-1 gap-12 lg:grid-cols-2">
        <Gallery images={product.images} productName={product.name} />

        <div className="flex flex-col gap-8">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-foreground">
              {product.name}
            </h1>
            {product.description && (
              <p className="mt-4 text-foreground/70">{product.description}</p>
            )}
          </div>

          <PurchasePanel
            productId={product.id}
            // Se enumeran los campos que cruzan a proposito, en vez de mandar
            // la variante entera menos costPrice: los Decimal de Prisma no
            // cruzan la frontera a un client component, y con "todo menos X"
            // el dia que se agregue otro Decimal vuelve a romper en runtime.
            // El precio ya viaja formateado en priceBySku.
            variants={product.variants.map((v) => ({
              id: v.id,
              sku: v.sku,
              colorName: v.colorName,
              sizeName: v.sizeName,
              materialName: v.materialName,
              stock: v.stock,
              reservedStock: v.reservedStock,
              active: v.active,
            }))}
            minOrderQuantity={product.minOrderQuantity}
            priceBySku={priceBySku}
            fallbackPriceLabel={
              rango ? formatPriceArs(rango.min) : formatPriceArs(0)
            }
          />

          {/* Va ANTES de Personalización: primero qué es el producto,
              después cómo se personaliza. */}
          <ProductAttributes attributes={product.attributes} />

          <PrintingInfo areas={product.printingAreas} types={product.printingTypes} />
        </div>
      </div>
    </div>
  );
}

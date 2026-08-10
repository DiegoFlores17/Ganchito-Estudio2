import { notFound } from "next/navigation";
import Link from "next/link";
import { Gallery } from "@/components/product/gallery";
import { PrintingInfo } from "@/components/product/printing-info";
import { PurchasePanel } from "@/components/product/purchase-panel";
import { getProductById } from "@/lib/product";
import { computeSellPrice, formatPriceArs, getPricingConfig } from "@/lib/pricing";

export default async function ProductoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [product, pricingConfig] = await Promise.all([
    getProductById(id),
    getPricingConfig(),
  ]);

  if (!product) notFound();

  const sellPrice = computeSellPrice(
    product.costPrice,
    pricingConfig.defaultMarginPercent
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      {product.category && (
        <Link
          href={`/catalogo?categoria=${product.category.slug}`}
          className="text-sm font-medium text-foreground/60 transition-colors hover:text-primary"
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
            variants={product.variants}
            minOrderQuantity={product.minOrderQuantity}
            priceLabel={formatPriceArs(sellPrice)}
          />

          <PrintingInfo areas={product.printingAreas} types={product.printingTypes} />
        </div>
      </div>
    </div>
  );
}

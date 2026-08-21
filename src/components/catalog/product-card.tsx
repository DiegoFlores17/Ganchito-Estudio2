import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatPriceArs } from "@/lib/format";
import { ProductCardImage } from "@/components/catalog/product-card-image";

type ProductCardData = Prisma.ProductGetPayload<{
  include: {
    images: true;
    variants: { select: { stock: true; reservedStock: true } };
  };
}>;

export function ProductCard({
  product,
  sellPrice,
  priceVaries = false,
  inStock,
  catalogQuery,
}: {
  product: ProductCardData;
  /// Precio a mostrar. Si priceVaries es true, es el MINIMO de las variantes.
  sellPrice: Prisma.Decimal;
  /// true cuando las variantes no cuestan todas lo mismo. La card pasa a
  /// mostrar "Desde $X": un piso honesto, en vez de un precio exacto que no
  /// le corresponde a la mayoria de las variantes.
  priceVaries?: boolean;
  inStock: boolean;
  /** Query string del catalogo actual (pagina/categoria/busqueda), para que
   * la ficha de producto pueda ofrecer un "volver" que preserve el filtro. */
  catalogQuery?: string;
}) {
  const image = product.images[0];
  const params = new URLSearchParams();
  if (catalogQuery) params.set("desde", catalogQuery);
  const href = `/producto/${product.id}${params.size ? `?${params}` : ""}`;

  return (
    <Link href={href} className="group flex flex-col gap-4">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] transition-shadow duration-300 group-hover:shadow-lg group-hover:shadow-foreground/10">
        {image ? (
          <ProductCardImage
            src={image.url}
            alt={product.name}
            sizes="(min-width: 1024px) 23vw, (min-width: 640px) 45vw, 90vw"
            className="object-cover group-hover:scale-[1.04]"
          />
        ) : null}

        {!inStock && (
          <span className="absolute left-3 top-3 rounded-full bg-primary-dark/90 px-3 py-1 text-xs font-medium text-white">
            Consultar disponibilidad
          </span>
        )}
      </div>

      <div>
        <p className="line-clamp-2 text-sm font-medium text-foreground transition-colors group-hover:text-primary-light">
          {product.name}
        </p>
        <p className="mt-1.5 text-base font-semibold text-foreground">
          {priceVaries && (
            <span className="text-sm font-normal text-foreground/45">
              Desde{" "}
            </span>
          )}
          {formatPriceArs(sellPrice)}{" "}
          <span className="text-sm font-normal text-foreground/45">+ IVA</span>
        </p>
      </div>
    </Link>
  );
}

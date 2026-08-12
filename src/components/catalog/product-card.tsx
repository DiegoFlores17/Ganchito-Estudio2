import Image from "next/image";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatPriceArs } from "@/lib/format";

type ProductCardData = Prisma.ProductGetPayload<{
  include: {
    images: true;
    variants: { select: { stock: true; reservedStock: true } };
  };
}>;

export function ProductCard({
  product,
  sellPrice,
  inStock,
}: {
  product: ProductCardData;
  sellPrice: Prisma.Decimal;
  inStock: boolean;
}) {
  const image = product.images[0];

  return (
    <Link href={`/producto/${product.id}`} className="group flex flex-col gap-4">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] transition-shadow duration-300 group-hover:shadow-lg group-hover:shadow-foreground/10">
        {image ? (
          <Image
            src={image.url}
            alt={product.name}
            fill
            sizes="(min-width: 1024px) 23vw, (min-width: 640px) 45vw, 90vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
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
          {formatPriceArs(sellPrice)}{" "}
          <span className="text-sm font-normal text-foreground/45">+ IVA</span>
        </p>
      </div>
    </Link>
  );
}

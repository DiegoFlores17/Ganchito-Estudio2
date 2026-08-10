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
    <Link href={`/producto/${product.id}`} className="group flex flex-col gap-3">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-foreground/5">
        {image ? (
          <Image
            src={image.url}
            alt={product.name}
            fill
            sizes="(min-width: 1024px) 23vw, (min-width: 640px) 45vw, 90vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : null}

        {!inStock && (
          <span className="absolute left-3 top-3 rounded-full bg-primary-dark/90 px-3 py-1 text-xs font-medium text-white">
            Consultar disponibilidad
          </span>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-foreground">{product.name}</p>
        <p className="mt-1 text-sm text-foreground/70">
          {formatPriceArs(sellPrice)}{" "}
          <span className="text-foreground/50">+ IVA</span>
        </p>
      </div>
    </Link>
  );
}

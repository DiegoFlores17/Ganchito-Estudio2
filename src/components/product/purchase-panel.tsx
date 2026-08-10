"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

interface VariantData {
  id: string;
  sku: string;
  colorName: string | null;
  sizeName: string | null;
  materialName: string | null;
  stock: number;
  reservedStock: number;
  active: boolean;
}

function uniqueNonEmpty(values: (string | null)[]): string[] {
  return [...new Set(values.map((v) => v?.trim()).filter((v): v is string => !!v))];
}

export function PurchasePanel({
  productId,
  variants,
  minOrderQuantity,
  priceLabel,
}: {
  productId: string;
  variants: VariantData[];
  minOrderQuantity: number | null;
  priceLabel: string;
}) {
  const activeVariants = useMemo(
    () => variants.filter((v) => v.active),
    [variants]
  );
  const colors = useMemo(
    () => uniqueNonEmpty(activeVariants.map((v) => v.colorName)),
    [activeVariants]
  );

  const [selectedColor, setSelectedColor] = useState<string | undefined>(
    colors[0]
  );

  const sizes = useMemo(
    () =>
      uniqueNonEmpty(
        activeVariants
          .filter((v) => !colors.length || v.colorName === selectedColor)
          .map((v) => v.sizeName)
      ),
    [activeVariants, colors.length, selectedColor]
  );

  const [selectedSize, setSelectedSize] = useState<string | undefined>(
    sizes[0]
  );

  const selectedVariant =
    activeVariants.find(
      (v) =>
        (!colors.length || v.colorName === selectedColor) &&
        (!sizes.length || v.sizeName === selectedSize)
    ) ?? activeVariants[0];

  const minQuantity = minOrderQuantity ?? 1;
  const [quantity, setQuantity] = useState(minQuantity);

  const available = selectedVariant
    ? Math.max(0, selectedVariant.stock - selectedVariant.reservedStock)
    : 0;
  const inStock = available > 0;

  function handleColorChange(color: string) {
    setSelectedColor(color);
    const sizesForColor = uniqueNonEmpty(
      activeVariants
        .filter((v) => v.colorName === color)
        .map((v) => v.sizeName)
    );
    setSelectedSize(sizesForColor[0]);
  }

  const quoteHref = selectedVariant
    ? `/cotizar?producto=${productId}&variante=${encodeURIComponent(selectedVariant.sku)}&cantidad=${quantity}`
    : `/cotizar?producto=${productId}&cantidad=${quantity}`;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-2xl text-foreground">
        {priceLabel} <span className="text-base text-foreground/50">+ IVA</span>
      </p>

      {colors.length > 0 && (
        <div>
          <p className="text-sm font-medium text-foreground">Color</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => handleColorChange(color)}
                className={
                  "rounded-full border px-4 py-2 text-sm transition-colors " +
                  (color === selectedColor
                    ? "border-primary bg-primary text-white"
                    : "border-foreground/15 text-foreground/70 hover:border-primary")
                }
              >
                {color}
              </button>
            ))}
          </div>
        </div>
      )}

      {sizes.length > 0 && (
        <div>
          <p className="text-sm font-medium text-foreground">Talle</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {sizes.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setSelectedSize(size)}
                className={
                  "rounded-full border px-4 py-2 text-sm transition-colors " +
                  (size === selectedSize
                    ? "border-primary bg-primary text-white"
                    : "border-foreground/15 text-foreground/70 hover:border-primary")
                }
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-medium text-foreground">Cantidad</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(minQuantity, q - 1))}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground/15 text-foreground/70 hover:border-primary"
            aria-label="Restar"
          >
            −
          </button>
          <span className="w-10 text-center text-sm font-medium text-foreground">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => q + 1)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground/15 text-foreground/70 hover:border-primary"
            aria-label="Sumar"
          >
            +
          </button>
        </div>
        {minOrderQuantity ? (
          <p className="mt-2 text-xs text-foreground/50">
            Cantidad minima: {minOrderQuantity} unidades
          </p>
        ) : null}
      </div>

      {!inStock && (
        <p className="rounded-lg bg-primary-dark/5 px-3 py-2 text-sm text-primary-dark">
          Consultar disponibilidad para esta variante
        </p>
      )}

      <Link
        href={quoteHref}
        className="rounded-full bg-accent px-6 py-3.5 text-center text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
      >
        Pedir cotizacion
      </Link>
      <p className="text-xs text-foreground/50">
        No es una compra con pago inmediato. El logo se carga en el paso de
        cotizacion.
      </p>
    </div>
  );
}

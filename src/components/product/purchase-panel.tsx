"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { addToQuoteCart } from "@/lib/quote-cart";

const TOAST_MS = 3200;

interface VariantData {
  id: string;
  sku: string;
  colorName: string | null;
  sizeName: string | null;
  materialName: string | null;
  /// Ya calculado server-side (stock - reservado): el bruto y el reservado
  /// no cruzan al cliente — son informacion operativa del proveedor.
  availableStock: number;
  active: boolean;
}

interface DraftLine {
  sku: string;
  colorName: string | null;
  sizeName: string | null;
  quantity: number;
  outOfStock: boolean;
}

function uniqueNonEmpty(values: (string | null)[]): string[] {
  return [
    ...new Set(values.map((v) => v?.trim()).filter((v): v is string => !!v)),
  ];
}

const pillClasses = (active: boolean) =>
  "rounded-full border px-4 py-2 text-sm transition-colors " +
  (active
    ? "border-primary bg-primary text-white"
    : "border-foreground/15 text-foreground/70 hover:border-primary");

export function PurchasePanel({
  productId,
  variants,
  minOrderQuantity,
  priceBySku,
  fallbackPriceLabel,
}: {
  productId: string;
  variants: VariantData[];
  minOrderQuantity: number | null;
  /// Precio de venta ya formateado, por SKU de variante. Viene calculado del
  /// server: el costo ahora vive en la variante, asi que el precio cambia
  /// segun lo que elija el cliente.
  priceBySku: Record<string, string>;
  /// Que mostrar mientras no hay variante resuelta (producto sin variantes
  /// activas, o un SKU que no figura en el mapa). Es el minimo del producto.
  fallbackPriceLabel: string;
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

  // Hay que armar la lista multi-linea si el producto tiene CUALQUIER eje de
  // variante (color y/o talle) — un producto puede tener solo talle, sin
  // color, y el selector de talle no debe perderse en ese caso.
  const hasVariantOptions = colors.length > 0 || sizes.length > 0;

  const selectedVariant =
    activeVariants.find(
      (v) =>
        (!colors.length || v.colorName === selectedColor) &&
        (!sizes.length || v.sizeName === selectedSize)
    ) ?? activeVariants[0];

  // El precio sigue a la variante elegida. Si el SKU no esta en el mapa (no
  // deberia pasar: viene del mismo producto), cae al minimo en vez de mostrar
  // un hueco.
  const precioMostrado =
    (selectedVariant && priceBySku[selectedVariant.sku]) ?? fallbackPriceLabel;

  // minOrderQuantity es el minimo de PERSONALIZACION del proveedor a nivel
  // PRODUCTO (minimum_order_quantity de Zecat) — no es un piso por cada
  // combinacion. Con variantes, cada linea puede ser cualquier cantidad
  // (piso 1) y el minimo se valida sobre la SUMA de todas las lineas. Sin
  // variantes hay una sola cantidad para todo el producto, asi que ahi si
  // es directamente el piso de esa cantidad.
  const minQuantity = minOrderQuantity ?? 1;
  const lineFloor = hasVariantOptions ? 1 : minQuantity;
  const [quantity, setQuantity] = useState(lineFloor);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [addedToast, setAddedToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  function showAddedToast(message: string) {
    setAddedToast(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setAddedToast(null), TOAST_MS);
  }

  const available = selectedVariant ? selectedVariant.availableStock : 0;
  const outOfStock = selectedVariant ? available <= 0 : false;
  // Sin stock: no se cappea la cantidad (se avisa y se deja pedir igual,
  // el cliente puede necesitar mas de lo que el sync todavia reflejo).
  // Con stock, la cantidad nunca puede superar lo disponible.
  const maxQuantity = outOfStock ? Infinity : available;

  function clampQuantity(value: number): number {
    return Math.min(Math.max(value, lineFloor), maxQuantity);
  }

  function handleColorChange(color: string) {
    setSelectedColor(color);
    const sizesForColor = uniqueNonEmpty(
      activeVariants
        .filter((v) => v.colorName === color)
        .map((v) => v.sizeName)
    );
    setSelectedSize(sizesForColor[0]);
    setQuantity(lineFloor);
  }

  function handleSizeChange(size: string) {
    setSelectedSize(size);
    setQuantity(lineFloor);
  }

  function handleAddLine() {
    if (!selectedVariant) return;

    const existingIndex = lines.findIndex(
      (line) => line.sku === selectedVariant.sku
    );

    if (existingIndex >= 0) {
      setLines((prev) => {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + quantity,
        };
        return next;
      });
      setNotice("Ya tenías esa combinación agregada: sumamos la cantidad.");
    } else {
      setLines((prev) => [
        ...prev,
        {
          sku: selectedVariant.sku,
          colorName: selectedVariant.colorName,
          sizeName: selectedVariant.sizeName,
          quantity,
          outOfStock,
        },
      ]);
      setNotice(null);
    }

    setQuantity(lineFloor);
  }

  function handleRemoveLine(sku: string) {
    setLines((prev) => prev.filter((line) => line.sku !== sku));
  }

  const linesTotal = lines.reduce((sum, line) => sum + line.quantity, 0);
  const minimumMet = !hasVariantOptions || linesTotal >= minQuantity;

  function handleAddToQuote() {
    if (hasVariantOptions) {
      if (lines.length === 0 || !minimumMet) return;
      for (const line of lines) {
        addToQuoteCart({
          productId,
          variantSku: line.sku,
          quantity: line.quantity,
        });
      }
      showAddedToast(
        lines.length === 1
          ? "Agregamos 1 combinación a tu cotización."
          : `Agregamos ${lines.length} combinaciones a tu cotización.`
      );
      setLines([]);
      setNotice(null);
    } else {
      addToQuoteCart({
        productId,
        variantSku: selectedVariant?.sku,
        quantity,
      });
      showAddedToast("Agregado a tu cotización.");
      setQuantity(lineFloor);
    }
  }

  const comboLabel = [selectedColor, selectedSize].filter(Boolean).join(" / ");

  return (
    <div className="flex flex-col gap-6">
      <p className="text-2xl text-foreground">
        {precioMostrado}{" "}
        <span className="text-base text-foreground/50">+ IVA</span>
      </p>

      {hasVariantOptions && (
        <>
          <div>
            <p className="text-sm font-medium text-foreground">Color</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => handleColorChange(color)}
                  className={pillClasses(color === selectedColor)}
                >
                  {color}
                </button>
              ))}
            </div>
          </div>

          {sizes.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground">Talle</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {sizes.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => handleSizeChange(size)}
                    className={pillClasses(size === selectedSize)}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div>
        <p className="text-sm font-medium text-foreground">Cantidad</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setQuantity((q) => clampQuantity(q - 1))}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground/15 text-foreground/70 hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
            disabled={quantity <= lineFloor}
            aria-label="Restar"
          >
            −
          </button>
          <span className="w-10 text-center text-sm font-medium text-foreground">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => clampQuantity(q + 1))}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground/15 text-foreground/70 hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
            disabled={quantity >= maxQuantity}
            aria-label="Sumar"
          >
            +
          </button>
        </div>
        {!hasVariantOptions && minOrderQuantity ? (
          <p className="mt-2 text-xs text-foreground/50">
            Cantidad mínima: {minOrderQuantity} unidades
          </p>
        ) : null}
      </div>

      {outOfStock ? (
        <p className="rounded-lg bg-primary-dark/5 px-3 py-2 text-sm text-primary-dark">
          Consultar disponibilidad{hasVariantOptions ? " para esta combinación" : ""}.
          Igual podés agregarla a tu pedido.
        </p>
      ) : hasVariantOptions && available <= minQuantity + 2 ? (
        <p className="text-xs text-foreground/50">
          Quedan {available} disponibles.
        </p>
      ) : null}

      {hasVariantOptions ? (
        <>
          <button
            type="button"
            onClick={handleAddLine}
            className="rounded-full border border-dashed border-primary px-4 py-2.5 text-center text-sm font-medium text-primary transition-colors hover:bg-primary/5"
          >
            + Agregar combinación{comboLabel ? ` (${comboLabel})` : ""}
          </button>

          {notice && (
            <p className="text-xs text-primary-dark">{notice}</p>
          )}

          <div className="border-t border-foreground/10 pt-4">
            <p className="text-sm font-medium text-foreground">
              Tu pedido de este producto
            </p>
            {lines.length === 0 ? (
              <p className="mt-2 text-sm italic text-foreground/50">
                Todavía no agregaste ninguna combinación.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-foreground/10">
                {lines.map((line) => (
                  <li
                    key={line.sku}
                    className="flex items-center justify-between gap-2 py-2.5"
                  >
                    <div className="text-sm text-foreground">
                      <span className="font-medium">
                        {[line.colorName, line.sizeName]
                          .filter(Boolean)
                          .join(" / ")}
                      </span>{" "}
                      <span className="text-foreground/60">
                        · {line.quantity} u.
                      </span>
                      {line.outOfStock && (
                        <span className="ml-2 rounded-full bg-primary-dark px-2 py-0.5 text-xs font-medium text-white">
                          Consultar disponibilidad
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(line.sku)}
                      className="text-xs text-foreground/50 hover:text-primary-dark"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {minOrderQuantity ? (
            <p
              className={
                "text-sm " +
                (minimumMet
                  ? "text-foreground/50"
                  : "font-medium text-primary-dark")
              }
            >
              Llevás {linesTotal} de {minOrderQuantity} unidades mínimas
              {!minimumMet &&
                ` — agregá ${minOrderQuantity - linesTotal} más para poder cotizar este producto`}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleAddToQuote}
            disabled={lines.length === 0 || !minimumMet}
            className="rounded-full bg-accent px-6 py-3.5 text-center text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-foreground/10 disabled:text-foreground/40"
          >
            Agregar a mi cotización
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={handleAddToQuote}
          className="rounded-full bg-accent px-6 py-3.5 text-center text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
        >
          Agregar a mi cotización
        </button>
      )}

      {addedToast && (
        <p className="rounded-lg bg-primary/5 px-3 py-2.5 text-sm text-primary-dark">
          {addedToast}{" "}
          <Link href="/cotizar" className="font-medium underline underline-offset-2">
            Ver mi cotización
          </Link>
        </p>
      )}

      <p className="text-xs text-foreground/50">
        No es una compra con pago inmediato. El logo se carga en el paso de
        cotización.
      </p>
    </div>
  );
}

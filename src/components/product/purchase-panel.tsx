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
  bulkPriceBySku,
  bulkFromQuantity,
  fallbackPriceLabel,
}: {
  productId: string;
  variants: VariantData[];
  minOrderQuantity: number | null;
  /// Precio de venta ya formateado, por SKU de variante. Viene calculado del
  /// server: el costo ahora vive en la variante, asi que el precio cambia
  /// segun lo que elija el cliente.
  ///
  /// Este es el precio de UNA unidad.
  priceBySku: Record<string, string>;
  /// El mismo precio, pero a partir de 2 unidades del producto, con el
  /// descuento de rango del proveedor ya aplicado.
  ///
  /// Son dos mapas y no una funcion de calculo porque NINGUNA cuenta de dinero
  /// ocurre en el navegador: el server manda los valores posibles y aca solo
  /// se elige cual mostrar. Ademas de ser mas seguro, importar el modulo de
  /// precios del lado del cliente arrastraria el cliente de Prisma entero al
  /// bundle (ver el comentario de lib/format.ts).
  bulkPriceBySku: Record<string, string>;
  /// A partir de cuantas unidades del producto vale `bulkPriceBySku`. Viaja
  /// como prop y no se importa la constante del conector: este componente es
  /// de la tienda y no tiene por que saber que el umbral lo define Zecat.
  bulkFromQuantity: number;
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

  // Si dos variantes del mismo producto valen distinto EN CANTIDAD, hay que
  // avisarlo: el cliente elige 3XL y el precio sube sin nada que lo explique.
  // Pasa en los seis textiles de Zecat, donde el talle grande descuenta mucho
  // menos (14,82% contra 37,83% en la Regent).
  //
  // Se compara sobre los precios ya formateados a proposito: es para decidir
  // si mostrar una linea de texto, no para calcular dinero. Lo que importa es
  // si el cliente VE numeros distintos.
  const precioVariaPorVariante = useMemo(() => {
    const distintos = new Set(
      activeVariants.map((v) => bulkPriceBySku[v.sku] ?? "")
    );
    return distintos.size > 1;
  }, [activeVariants, bulkPriceBySku]);

  // minOrderQuantity es el minimo REAL de compra a nivel PRODUCTO
  // (minimum_application_quantity de Zecat, lo que su backoffice muestra
  // como "Bonificacion del costo por debajo del minimo desde: N un.") — no
  // es un piso por cada combinacion. Con variantes, cada linea puede ser
  // cualquier cantidad
  // (piso 1) y el minimo se valida sobre la SUMA de todas las lineas. Sin
  // variantes hay una sola cantidad para todo el producto, asi que ahi si
  // es directamente el piso de esa cantidad.
  const minQuantity = minOrderQuantity ?? 1;
  const lineFloor = hasVariantOptions ? 1 : minQuantity;
  const [quantity, setQuantity] = useState(lineFloor);
  // El texto del input va SEPARADO del numero: mientras se escribe "165"
  // el valor pasa por "1" y por "16", y validar en cada tecla le pisaria
  // lo que esta tipeando (o lo clampearia al minimo). El numero se
  // sincroniza al salir del campo o al usar los botones.
  const [quantityText, setQuantityText] = useState(String(lineFloor));
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

  /// Unico camino para mover la cantidad: mantiene numero y texto en sinc.
  function aplicarCantidad(value: number) {
    const n = clampQuantity(value);
    setQuantity(n);
    setQuantityText(String(n));
  }

  /// Al salir del campo se valida y se corrige, no antes. Si lo que quedo
  /// no es un numero usable, se vuelve al ultimo valor valido en vez de
  /// dejar el campo roto o vacio.
  function confirmarCantidadEscrita() {
    const n = parseInt(quantityText.replace(/\D/g, ""), 10);
    if (Number.isNaN(n) || n < 1) {
      aplicarCantidad(quantity);
      return;
    }
    aplicarCantidad(n);
  }

  /// La variante que corresponde a un par (color, talle) concreto.
  ///
  /// Hace falta en los handlers de cambio porque ahi el estado TODAVIA no se
  /// actualizo: `selectedVariant`, `available` y `maxQuantity` siguen siendo
  /// los de la variante vieja, y clampear contra ese stock daria el tope
  /// equivocado.
  function variantePara(color?: string, size?: string) {
    return (
      activeVariants.find(
        (v) =>
          (!colors.length || v.colorName === color) &&
          (!sizes.length || v.sizeName === size)
      ) ?? activeVariants[0]
    );
  }

  /// Al cambiar de variante se CONSERVA la cantidad, recortandola al stock de
  /// la nueva si no entra.
  ///
  /// Antes volvia a 1, y con el precio dependiendo de la cantidad eso mentia:
  /// la ficha invita a comparar talles ("El precio varía según el talle"), y
  /// si al cambiar de talle la cantidad se reseteaba, el cliente comparaba el
  /// precio con descuento de uno contra el precio de 1 unidad del otro. En la
  /// Remera Regent eso mostraba $6.974 contra $11.218 cuando la diferencia
  /// real es contra $9.555: una comparacion inflada, peor que no avisar nada.
  ///
  /// El tope por stock no cambia — solo se aplica sobre la cantidad que el
  /// cliente ya habia elegido en vez de forzarla al piso.
  function conservarCantidad(variant: VariantData | undefined) {
    const disponible = variant ? variant.availableStock : 0;
    // Mismo criterio que maxQuantity: sin stock no se cappea (se avisa y se
    // deja pedir igual).
    const tope = disponible <= 0 ? Infinity : disponible;
    const n = Math.min(Math.max(quantity, lineFloor), tope);
    setQuantity(n);
    setQuantityText(String(n));
  }

  function handleColorChange(color: string) {
    setSelectedColor(color);
    const sizesForColor = uniqueNonEmpty(
      activeVariants
        .filter((v) => v.colorName === color)
        .map((v) => v.sizeName)
    );
    setSelectedSize(sizesForColor[0]);
    conservarCantidad(variantePara(color, sizesForColor[0]));
  }

  function handleSizeChange(size: string) {
    setSelectedSize(size);
    conservarCantidad(variantePara(selectedColor, size));
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

    aplicarCantidad(lineFloor);
  }

  function handleRemoveLine(sku: string) {
    setLines((prev) => prev.filter((line) => line.sku !== sku));
  }

  const linesTotal = lines.reduce((sum, line) => sum + line.quantity, 0);
  const minimumMet = !hasVariantOptions || linesTotal >= minQuantity;

  // El total del PRODUCTO que define el tramo de descuento: lo ya agregado mas
  // lo que hay en el selector. Verificado en el backoffice de Zecat que el
  // tramo se elige por el total del producto sumando todas sus variantes — 50
  // talle S + 50 talle M caen en el tramo de 100, no en el de 2.
  //
  // Se suma `quantity` (lo que todavia no se agrego) porque el precio tiene
  // que responder a lo que el cliente esta armando AHORA: escribe 50 y el
  // precio baja, sin tener que agregar la combinacion para enterarse. En un
  // producto sin variantes no hay lineas, asi que el total es `quantity` a
  // secas y la formula sirve igual.
  const totalDelProducto = linesTotal + quantity;

  // El precio sigue a la variante elegida Y a la cantidad. Si el SKU no esta
  // en el mapa (no deberia pasar: viene del mismo producto), cae al minimo en
  // vez de mostrar un hueco.
  const mapaDePrecios =
    totalDelProducto >= bulkFromQuantity ? bulkPriceBySku : priceBySku;
  const precioMostrado =
    (selectedVariant && mapaDePrecios[selectedVariant.sku]) ??
    fallbackPriceLabel;

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
      aplicarCantidad(lineFloor);
    }
  }

  const comboLabel = [selectedColor, selectedSize].filter(Boolean).join(" / ");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-2xl text-foreground">
          {precioMostrado}{" "}
          <span className="text-base text-foreground/50">+ IVA</span>
        </p>
        {/* Sobria a proposito: dice QUE el precio cambia, no por que ni
            cuanto. El porcentaje del proveedor no se muestra — es su
            estructura de costos, no información para el cliente. */}
        {precioVariaPorVariante && (
          <p className="mt-1 text-xs text-foreground/50">
            El precio varía según {sizes.length > 0 ? "el talle" : "la opción"}{" "}
            que elijas.
          </p>
        )}
      </div>

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
            onClick={() => aplicarCantidad(quantity - 1)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground/15 text-foreground/70 hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
            disabled={quantity <= lineFloor}
            aria-label="Restar"
          >
            −
          </button>
          {/* type="text" + inputMode numeric y NO type="number": este
              muestra el teclado numerico en el celular igual, pero deja
              controlar el texto intermedio y no arrastra los spinners ni
              la rueda del mouse cambiando el valor sin querer.
              Pegar un numero (el comprador corporativo lo tiene en un mail
              o una planilla) funciona solo. */}
          <input
            type="text"
            inputMode="numeric"
            value={quantityText}
            onChange={(e) => setQuantityText(e.target.value)}
            onBlur={confirmarCantidadEscrita}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            maxLength={6}
            aria-label="Cantidad"
            className="w-20 rounded-lg border border-foreground/15 px-3 py-1.5 text-center text-sm font-medium text-foreground outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => aplicarCantidad(quantity + 1)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground/15 text-foreground/70 hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
            disabled={quantity >= maxQuantity}
            aria-label="Sumar"
          >
            +
          </button>
        </div>
        {/* Un minimo de 1 no es un minimo: no se avisa. Desde que el minimo
            sale del campo correcto, 624 de los 641 productos de Zecat estan
            en 1, y anunciarlo llenaba el catalogo de un cartel que no pide
            nada. Ademas evita el "1 unidades". */}
        {!hasVariantOptions && minQuantity > 1 ? (
          <p className="mt-2 text-xs text-foreground/50">
            Cantidad mínima: {minQuantity} unidades
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

          {/* Mismo criterio que arriba: con minimo 1, "Llevás 0 de 1 unidades
              mínimas" no informa nada que no digan ya el estado vacío de la
              lista y el botón deshabilitado. El aviso queda para los pocos
              productos donde el mínimo es una condición real. */}
          {minQuantity > 1 ? (
            <p
              className={
                "text-sm " +
                (minimumMet
                  ? "text-foreground/50"
                  : "font-medium text-primary-dark")
              }
            >
              Llevás {linesTotal} de {minQuantity} unidades mínimas
              {!minimumMet &&
                ` — agregá ${minQuantity - linesTotal} más para poder cotizar este producto`}
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

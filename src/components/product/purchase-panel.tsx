"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { addToQuoteCart } from "@/lib/quote-cart";
import type { EscalonPrecio } from "@/lib/pricing";

const TOAST_MS = 3200;

/// Cuantos escalones de precio se muestran antes del "ver mas".
///
/// La escala completa es correcta en contenido pero pesada de entrada: siete
/// filas al abrir la ficha compiten con el precio, que es lo que el cliente
/// vino a ver. Cuatro alcanzan para entender que bajando la cantidad sube el
/// precio unitario, y el resto queda a un click.
const MAX_ESCALONES_VISIBLES = 4;

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
  escalonesPorSku,
  bulkFromQuantity,
  fallbackPriceLabel,
}: {
  productId: string;
  variants: VariantData[];
  minOrderQuantity: number | null;
  /// La escala de precios de cada variante: cada escalon con desde cuantas
  /// unidades rige y el precio de venta YA FORMATEADO.
  ///
  /// Viene calculado del server y no se hace ninguna cuenta de dinero aca:
  /// este componente solo elige que escalon mostrar. Ademas de ser mas seguro,
  /// importar el modulo de precios del lado del cliente arrastraria el cliente
  /// de Prisma entero al bundle (ver el comentario de lib/format.ts).
  ///
  /// Por SKU porque las variantes pueden tener escalas distintas: en la Remera
  /// Regent, Blanco S y Blanco 3XL no comparten ni los cortes ni los
  /// porcentajes.
  escalonesPorSku: Record<string, EscalonPrecio[]>;
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
  //
  // OJO: esto dice si las variantes PUEDEN valer distinto, no si valen distinto
  // AHORA. Con cantidad 1 todas valen lo mismo, porque el descuento arranca en
  // 2 unidades — por eso el JSX exige ademas que el total llegue a 2 antes de
  // mostrar la nota. Sin esa condicion, el cliente leia "el precio varía según
  // el talle", probaba dos talles, veia el mismo numero, y la nota quedaba
  // desmentida justo antes de empezar a ser verdad.
  const precioVariaPorVariante = useMemo(() => {
    // Se compara el precio a partir de 2 unidades, que es donde las escalas
    // empiezan a diferir: con 1 unidad todas las variantes de un producto de
    // Zecat valen lo mismo y la nota nunca apareceria.
    const distintos = new Set(
      activeVariants.map((v) => {
        const esc = escalonesPorSku[v.sku] ?? [];
        return esc[indiceEscalon(esc, bulkFromQuantity)]?.precio ?? "";
      })
    );
    return distintos.size > 1;
  }, [activeVariants, escalonesPorSku, bulkFromQuantity]);

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

  // El precio sigue a la variante elegida Y a la cantidad: se busca el escalon
  // mas alto que no supere el total del producto. Si el SKU no esta en el mapa
  // (no deberia pasar: viene del mismo producto), cae al minimo en vez de
  // mostrar un hueco.
  const escalones = selectedVariant
    ? (escalonesPorSku[selectedVariant.sku] ?? [])
    : [];
  const indiceActual = indiceEscalon(escalones, totalDelProducto);
  const precioMostrado =
    escalones[indiceActual]?.precio ?? fallbackPriceLabel;

  // La escala COMPLETA, como la muestra Zecat: desde 1 unidad hasta el ultimo
  // tramo. Sin umbral de porcentaje — el umbral escondia la tabla justo cuando
  // el cliente esta decidiendo cuanto pedir, que es cuando sirve.
  //
  // Aparece con cantidad 1 o 0 igual: no hay que cargar nada para verla.
  const mostrarTabla = escalones.length > 1;

  // De las filas se ven las primeras cuatro y el resto detras de un "ver mas".
  //
  // Quien manda es una decision EXPLICITA del cliente si la tomo: null = no
  // toco el boton todavia, true = expandio, false = colapso. No es un booleano
  // porque hay tres estados y el tercero importa — que la tabla se haya
  // expandido sola una vez no le da derecho a pisar un colapso hecho a mano
  // mientras el cliente sigue ajustando la cantidad.
  const [verMasManual, setVerMasManual] = useState<boolean | null>(null);

  // La cantidad la expande sola al llegar al cuarto escalon: ahi el cliente ya
  // esta en posicion de alcanzar los siguientes.
  const expandidaPorCantidad = indiceActual >= MAX_ESCALONES_VISIBLES - 1;

  // Y una vez abierta por cantidad, se queda abierta aunque despues la baje:
  // colapsarse sola mientras alguien ajusta un numero se siente como que la
  // interfaz le saca cosas de adelante. Estado derivado ajustado en el render,
  // mismo patron que el panel de filtros del catalogo.
  const [seExpandioAlgunaVez, setSeExpandioAlgunaVez] = useState(false);
  if (expandidaPorCantidad && !seExpandioAlgunaVez) {
    setSeExpandioAlgunaVez(true);
  }

  const expandida =
    verMasManual ?? (expandidaPorCantidad || seExpandioAlgunaVez);
  const filasTabla = expandida
    ? escalones
    : escalones.slice(0, MAX_ESCALONES_VISIBLES);
  const escalonesOcultos = escalones.length - filasTabla.length;

  // Un escalon por encima del stock de ESTA variante no se puede pedir hoy: el
  // input recorta la cantidad a lo disponible. El precio es verdadero (Zecat
  // lo cobraria si hubiera stock) asi que la fila no se saca, pero se atenua
  // para que no se lea como una promesa.
  //
  // Con stock 0 NO se atenua nada: ahi el input deja pedir de mas a proposito,
  // porque el sync puede estar atrasado. Atenuar toda la tabla en ese caso
  // seria mentir al reves.
  const hayTopeDeStock = !outOfStock && available > 0;
  const fueraDeStock = (desde: number) => hayTopeDeStock && desde > available;

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
        {precioVariaPorVariante && totalDelProducto >= bulkFromQuantity && (
          <p className="mt-1 text-xs text-foreground/50">
            El precio varía según {sizes.length > 0 ? "el talle" : "la opción"}{" "}
            que elijas.
          </p>
        )}

        {/* Precio por cantidad. SIN porcentajes: el descuento del proveedor es
            su estructura de costos, no informacion para el cliente. Lo que se
            comunica es que pidiendo mas paga menos por unidad.

            Es de la variante SELECCIONADA y cambia al elegir otro talle —
            mostrar la escala del S cuando el cliente eligio 3XL seria mostrarle
            un precio que no va a pagar. */}
        {mostrarTabla && (
          <div className="mt-3 inline-flex flex-col gap-1 rounded-lg bg-foreground/[0.03] px-3 py-2">
            {filasTabla.map((e, i) => {
              const inalcanzable = fueraDeStock(e.desde);
              return (
                <div
                  key={e.desde}
                  className={
                    "flex items-baseline justify-between gap-6 text-xs " +
                    (i === indiceActual
                      ? "font-medium text-foreground"
                      : inalcanzable
                        ? "text-foreground/30"
                        : "text-foreground/55")
                  }
                  // Para lector de pantalla la atenuacion no existe: hay que
                  // decirlo con palabras.
                  title={inalcanzable ? "Más unidades que las disponibles hoy" : undefined}
                >
                  <span>
                    {e.desde === 1 ? "1 unidad" : `${e.desde} unidades`}
                  </span>
                  <span className="tabular-nums">{e.precio} c/u</span>
                </div>
              );
            })}

            {/* El boton existe mientras haya algo que mostrar U ocultar: sin
                el "Ver menos", una tabla expandida se quedaba abierta para
                siempre. */}
            {(escalonesOcultos > 0 || expandida) &&
              escalones.length > MAX_ESCALONES_VISIBLES && (
                <button
                  type="button"
                  onClick={() => setVerMasManual(!expandida)}
                  className="mt-0.5 text-left text-xs text-primary transition-colors hover:text-primary-light"
                >
                  {expandida
                    ? "Ver menos"
                    : `Ver ${escalonesOcultos} ${escalonesOcultos === 1 ? "cantidad" : "cantidades"} más`}
                </button>
              )}
          </div>
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


/// Indice del escalon que rige para una cantidad: el mas alto cuyo `desde` no
/// la supera. Devuelve 0 (el de 1 unidad) si no hay ninguno.
function indiceEscalon(escalones: EscalonPrecio[], cantidad: number): number {
  let i = 0;
  for (let j = 0; j < escalones.length; j++) {
    if (cantidad >= escalones[j].desde) i = j;
    else break;
  }
  return i;
}


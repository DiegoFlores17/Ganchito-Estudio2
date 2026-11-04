"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  addToQuoteCart,
  cantidadesEnCarritoPorSku,
  getQuoteCartSnapshot,
  subscribeQuoteCart,
} from "@/lib/quote-cart";
import { cantidadRestante } from "@/lib/quote-stock";
import type { EscalonPrecio } from "@/lib/pricing";

const TOAST_MS = 3200;

/// Aviso para un carrito VIEJO: lo que el cliente guardo en otra visita puede
/// superar el stock de hoy si un sync lo bajo. Desde la decision de los duenos
/// (2026-11-04) la ficha ya no deja pedir mas que el stock, asi que este es el
/// unico camino que llega a un pedido mayor al stock. No bloquea nada: se
/// confirma al cotizar.
export const AVISO_CARRITO_MAYOR_AL_STOCK =
  "Lo que ya tenés en tu cotización supera el stock informado; lo confirmamos al cotizar.";

/// Debajo de esta cantidad disponible se muestra "Quedan N disponibles".
const POCO_STOCK = 3;

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
  escalonesPorSku,
  bulkFromQuantity,
  fallbackPriceLabel,
  leyendaPrecio,
}: {
  productId: string;
  variants: VariantData[];
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
  /// Aclaracion de lo que el precio NO incluye (personalizacion y envio).
  /// Viene resuelta del server (lib/leyendas-precio.ts).
  leyendaPrecio: string;
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

  // minOrderQuantity (umbral de personalizacion sin recargo del proveedor) NO
  // llega a este componente a proposito: es una condicion comercial del
  // proveedor hacia Ganchito, no informacion para el cliente (mismo criterio
  // que el porcentaje de descuento por cantidad). Solo se usa para marcas
  // internas en el mail y el panel; ver lib/quote-minimum.ts. Tampoco es un
  // minimo de compra: nunca bloquea ni fuerza la cantidad.
  // El piso de cualquier cantidad es 1. Tambien arranca en 1: forzar la
  // cantidad inicial al umbral (119 en el gorro) pondria al cliente a mirar
  // el precio de 119 unidades sin haberlo pedido, y el precio por escalon
  // dejaria de mostrar el de 1 unidad hasta que lo baje a mano.
  const lineFloor = 1;
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

  // DECISION DE LOS DUENOS (2026-11-04): la cantidad SE LIMITA al stock
  // disponible, como hace Zecat. Antes no se recortaba ("el stock es una foto
  // del ultimo sync, no un tope"); se revirtio para no prometer lo que no se
  // puede entregar. Una variante sin stock no se puede agregar, y un producto
  // con todas las variantes en 0 queda visible pero sin poder cotizarse hasta
  // que un sync lo reponga.
  //
  // El tope es el stock MENOS lo que ya esta pedido de ESA variante: lo que
  // hay en el carrito guardado (otras visitas) mas las lineas de este
  // borrador. Sin descontar el carrito, el tope se saltaba agregando de a
  // una unidad en dos visitas. El server NO rechaza nada: esto es un tope de
  // la ficha, y la marca del mail/panel cubre un carrito viejo.
  //
  // El umbral de recargo del proveedor no interviene ni se muestra aca.
  const carritoRaw = useSyncExternalStore(
    subscribeQuoteCart,
    getQuoteCartSnapshot,
    () => "[]"
  );
  const enCarrito = useMemo(
    () => cantidadesEnCarritoPorSku(carritoRaw, productId),
    [carritoRaw, productId]
  );

  /// Lo ya pedido de un sku: carrito guardado + lineas de este borrador.
  function reservadoDe(sku: string): number {
    return (
      (enCarrito[sku] ?? 0) +
      lines.filter((l) => l.sku === sku).reduce((sum, l) => sum + l.quantity, 0)
    );
  }

  /// Cuanto mas se puede agregar de la variante elegida.
  const restante = selectedVariant
    ? cantidadRestante(available, reservadoDe(selectedVariant.sku))
    : 0;
  const sinCupo = restante <= 0;

  // Al cambiar de variante o de lineas el tope se mueve: se corrige la
  // cantidad al renderizar (estado derivado, mismo patron que seExpandio...
  // abajo) en vez de hacerlo en cada handler, donde la variante todavia es la
  // vieja.
  if (restante > 0 && quantity > restante) {
    setQuantity(restante);
    setQuantityText(String(restante));
  } else if (restante <= 0 && quantity > lineFloor) {
    // Sin cupo no queda una cantidad vieja pegada: inflaria el escalon del
    // precio mostrado para una variante que no se puede agregar.
    setQuantity(lineFloor);
    setQuantityText(String(lineFloor));
  }

  // El piso es 1 y el techo es el
  // cupo. Sin cupo la cantidad queda en 1 y el agregar esta deshabilitado.
  function clampQuantity(value: number): number {
    const techo = restante > 0 ? restante : lineFloor;
    return Math.min(Math.max(value, lineFloor), techo);
  }

  /// El carrito guardado ya supera el stock de hoy (un sync lo bajo despues).
  const carritoSuperaElStock =
    selectedVariant !== undefined &&
    (enCarrito[selectedVariant.sku] ?? 0) > available;

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

  /// Al cambiar de variante se CONSERVA la cantidad.
  ///
  /// Antes volvia a 1, y con el precio dependiendo de la cantidad eso mentia:
  /// la ficha invita a comparar talles ("El precio varía según el talle"), y
  /// si al cambiar de talle la cantidad se reseteaba, el cliente comparaba el
  /// precio con descuento de uno contra el precio de 1 unidad del otro. En la
  /// Remera Regent eso mostraba $6.974 contra $11.218 cuando la diferencia
  /// real es contra $9.555: una comparacion inflada, peor que no avisar nada.
  ///
  /// El piso se respeta aca; el techo (el cupo de la NUEVA variante) lo aplica
  /// la correccion al renderizar, cuando la variante ya cambio.
  function conservarCantidad() {
    const n = Math.max(quantity, lineFloor);
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
    conservarCantidad();
  }

  function handleSizeChange(size: string) {
    setSelectedSize(size);
    conservarCantidad();
  }

  function handleAddLine() {
    if (!selectedVariant || sinCupo) return;
    // Defensa: nunca mas que el cupo, aunque el estado venga atrasado.
    const cantidad = Math.min(quantity, restante);

    const existingIndex = lines.findIndex(
      (line) => line.sku === selectedVariant.sku
    );

    if (existingIndex >= 0) {
      setLines((prev) => {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + cantidad,
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
          quantity: cantidad,
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

  // Un escalon por encima del stock informado de ESTA variante se atenua: la
  // cantidad esta limitada al stock, asi que ese tramo no se puede alcanzar.
  // El precio es verdadero y es informacion de la escala del proveedor, asi que
  // la fila no se saca.
  //
  // Con stock 0 NO se atenua nada: ahi ya sale "Sin stock por ahora" y
  // atenuar toda la tabla seria mentir al reves.
  const hayStockInformado = available > 0;
  const masQueElStock = (desde: number) => hayStockInformado && desde > available;

  function handleAddToQuote() {
    if (hasVariantOptions) {
      if (lines.length === 0) return;
      // Se vuelve a medir el cupo contra el carrito guardado de AHORA: otra
      // pestaña pudo sumar el mismo sku despues de armar este borrador.
      const enCarritoAhora = cantidadesEnCarritoPorSku(getQuoteCartSnapshot(), productId);
      for (const line of lines) {
        const variante = variants.find((v) => v.sku === line.sku);
        const cupo = cantidadRestante(variante?.availableStock ?? 0, enCarritoAhora[line.sku] ?? 0);
        const cantidad = Math.min(line.quantity, cupo);
        if (cantidad <= 0) continue;
        addToQuoteCart({
          productId,
          variantSku: line.sku,
          quantity: cantidad,
        });
        enCarritoAhora[line.sku] = (enCarritoAhora[line.sku] ?? 0) + cantidad;
      }
      showAddedToast(
        lines.length === 1
          ? "Agregamos 1 combinación a tu cotización."
          : `Agregamos ${lines.length} combinaciones a tu cotización.`
      );
      setLines([]);
      setNotice(null);
    } else {
      if (sinCupo) return;
      addToQuoteCart({
        productId,
        variantSku: selectedVariant?.sku,
        quantity: Math.min(quantity, restante),
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
        <p className="mt-1 text-xs text-foreground/50">{leyendaPrecio}</p>
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
              const inalcanzable = masQueElStock(e.desde);
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
                  title={inalcanzable ? "Más unidades que el stock informado" : undefined}
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
            disabled={quantity >= restante}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground/15 text-foreground/70 hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Sumar"
          >
            +
          </button>
        </div>
      </div>

      {/* Region viva SIEMPRE montada: un lector de pantalla anuncia el cambio
          de contenido, cosa que no hace con un nodo que aparece de golpe. */}
      <div aria-live="polite">
        {carritoSuperaElStock && (
          <p className="rounded-lg bg-primary-dark/5 px-3 py-2 text-sm text-primary-dark">
            {AVISO_CARRITO_MAYOR_AL_STOCK}
          </p>
        )}
      </div>

      {sinCupo ? (
        <p className="rounded-lg bg-primary-dark/5 px-3 py-2 text-sm text-primary-dark">
          {available <= 0
            ? `Sin stock por ahora${hasVariantOptions ? " en esta combinación" : ""}. Cuando se reponga la vas a poder cotizar.`
            : "Ya sumaste todo el stock disponible de esta opción."}
        </p>
      ) : hasVariantOptions && available <= POCO_STOCK ? (
        <p className="text-xs text-foreground/50">
          {available === 1 ? "Queda 1 disponible." : `Quedan ${available} disponibles.`}
        </p>
      ) : null}

      {hasVariantOptions ? (
        <>
          <button
            type="button"
            onClick={handleAddLine}
            disabled={sinCupo}
            className="rounded-full border border-dashed border-primary px-4 py-2.5 text-center text-sm font-medium text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:border-foreground/20 disabled:text-foreground/40 disabled:hover:bg-transparent"
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

          <button
            type="button"
            onClick={handleAddToQuote}
            disabled={lines.length === 0}
            // Marca para que la burbuja de WhatsApp se corra cuando este boton
            // esta a la vista. Va solo en el CIERRE de la accion: "+ Agregar
            // combinacion" se toca varias veces mientras se arma el pedido y
            // no es el momento de esconder nada.
            data-cta-principal
            className="rounded-full bg-accent px-6 py-3.5 text-center text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-foreground/10 disabled:text-foreground/40"
          >
            Agregar a mi cotización
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={handleAddToQuote}
          disabled={sinCupo}
          data-cta-principal
          className="rounded-full bg-accent px-6 py-3.5 text-center text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-foreground/10 disabled:text-foreground/40"
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


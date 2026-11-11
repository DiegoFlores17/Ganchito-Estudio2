"use client";

import {
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
  useState,
  useTransition,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { QuoteSkeleton } from "@/components/quote-skeleton";
import { aCentavos, formatPriceArsCentavos } from "@/lib/format";
import { impresionEnTotal, leyendaTotalCotizar } from "@/lib/leyendas-precio";
import {
  clearQuoteCart,
  getQuoteCart,
  getQuotePrinting,
  removeFromQuoteCart,
  replaceQuoteCart,
  setQuotePrinting,
} from "@/lib/quote-cart";
import { QuotePrintingPicker } from "@/components/quote-printing";
import { isOptimizableImage } from "@/lib/product-image";
import {
  getQuoteItemsSummary,
  submitQuote,
  type ProductPrintingSummary,
  type QuoteItemSummary,
} from "./actions";

export default function CotizarPage() {
  const [items, setItems] = useState<QuoteItemSummary[]>([]);
  // Personalizacion ofrecida por producto y lo elegido (clave de la opcion o
  // "ninguna"). Lo elegido se guarda en el navegador para no perderlo al
  // recargar; el servidor lo revalida igual al enviar.
  const [printing, setPrinting] = useState<ProductPrintingSummary[]>([]);
  const [selecciones, setSelecciones] = useState<Record<string, string>>({});
  const [loadingItems, setLoadingItems] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Aviso propio del checkbox de privacidad, en lugar del globito nativo del
  // navegador (que sale en su idioma y con su estilo, no el de la tienda).
  const [privacyMissing, setPrivacyMissing] = useState(false);
  // Productos del borrador que ya no se pueden cotizar. Se muestran, no se
  // descartan en silencio: si al cliente le desaparece un item sin aviso, va
  // a pensar que se olvido de agregarlo.
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [omittedOnSubmit, setOmittedOnSubmit] = useState<string[]>([]);
  // Para abrir el chat de WhatsApp con el pedido. waUrl llega del servidor
  // al enviar; whatsappAvailable llega ANTES (con el resumen) porque la
  // ventana tiene que abrirse en el gesto del click o Safari iOS la bloquea
  // — y sin numero configurado no hay que abrir ninguna.
  const [whatsappAvailable, setWhatsappAvailable] = useState(false);
  const [waUrl, setWaUrl] = useState<string | null>(null);
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Carga del resumen, con las DOS salidas de fallo que antes no existian:
  // .catch (la action rechazo) y timeout (la promesa nunca respondio — paso
  // en produccion: el skeleton quedaba para siempre, sin error ni salida).
  // `intento` en las deps permite el boton "Reintentar".
  const [loadFailed, setLoadFailed] = useState(false);
  const [intento, setIntento] = useState(0);
  // Id del ultimo pedido de resumen. Cada pedido (la carga y cada refetch al
  // quitar una linea) toma el siguiente, y al volver solo aplica su respuesta
  // si sigue siendo el ultimo: dos "Quitar" seguidos pueden volver en
  // cualquier orden, y una respuesta vieja pisaria a la nueva.
  const ultimoResumen = useRef(0);
  useEffect(() => {
    let cancelado = false;
    const pedido = ++ultimoResumen.current;

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 10_000)
    );

    const cart = getQuoteCart();
    Promise.race([getQuoteItemsSummary(cart, getQuotePrinting()), timeout])
      .then((summary) => {
        if (cancelado || pedido !== ultimoResumen.current) return;
        setItems(summary.items);
        setPrinting(summary.printing);
        setSelecciones(
          Object.fromEntries(summary.printing.map((p) => [p.productId, p.seleccion]))
        );
        setWhatsappAvailable(summary.whatsappAvailable);
        if (summary.unavailableNames.length > 0) {
          setUnavailable(summary.unavailableNames);
          // Podar el carrito guardado para que quede IGUAL al resumen: el
          // "Quitar" de cada linea borra por indice, y con el carrito mas
          // largo que el resumen los indices se corren y borra otra linea.
          replaceQuoteCart(
            summary.items.map((item) => ({
              productId: item.productId,
              variantSku: item.variantSku,
              quantity: item.quantity,
            }))
          );
        }
        setLoadingItems(false);
      })
      .catch(() => {
        if (cancelado || pedido !== ultimoResumen.current) return;
        setLoadFailed(true);
        setLoadingItems(false);
      });

    return () => {
      cancelado = true;
    };
  }, [intento]);

  function handleSeleccion(productId: string, seleccion: string) {
    setSelecciones((prev) => ({ ...prev, [productId]: seleccion }));
    const opcion = printing
      .find((p) => p.productId === productId)
      ?.opciones.find((o) => o.key === seleccion);
    setQuotePrinting(
      productId,
      opcion
        ? { zecatTypeId: opcion.zecatTypeId, zecatAreaId: opcion.zecatAreaId }
        : "ninguna"
    );
  }

  function handleRemove(index: number) {
    const restantes = removeFromQuoteCart(index);
    setItems((prev) => prev.filter((_, i) => i !== index));
    // Quitar una linea baja la cantidad del producto, y con eso pueden cambiar
    // el escalon de precio de sus otras lineas y aparecer el adicional por
    // cantidad chica. Lo decide el servidor (el umbral no esta en el
    // navegador), asi que se vuelve a pedir el resumen en silencio. Si falla,
    // queda el anterior: el envio revalida todo igual.
    const pedido = ++ultimoResumen.current;
    getQuoteItemsSummary(restantes, getQuotePrinting())
      .then((summary) => {
        if (pedido !== ultimoResumen.current) return;
        setPrinting(summary.printing);
        // Solo si el resumen trae las MISMAS lineas: si el servidor descarto
        // alguna, los indices de "Quitar" se correrian (ver la carga).
        if (summary.items.length === restantes.length) setItems(summary.items);
      })
      .catch(() => {});
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // No usamos <form action={fn}>: React resetea TODOS los campos
    // automaticamente cuando esa action termina, incluso si el servidor
    // rechaza el envio — el cliente perderia lo que ya tipeo por un error
    // de, por ejemplo, el formato del archivo. Con onSubmit + preventDefault
    // el formulario no se resetea solo.
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setError(null);
    formData.set(
      "items",
      JSON.stringify(
        items.map((item) => ({
          productId: item.productId,
          variantSku: item.variantSku,
          quantity: item.quantity,
        }))
      )
    );
    // Lo elegido de cada producto que sigue en el pedido. El servidor no
    // confia en esto: lo revalida contra las opciones del producto y, si no
    // es una de ellas, lo quita y lo marca.
    formData.set(
      "printing",
      JSON.stringify(
        Object.fromEntries(
          impresionVisible.map(({ printing: p }) => {
            const opcion = p.opciones.find((o) => o.key === selecciones[p.productId]);
            return [
              p.productId,
              opcion
                ? { zecatTypeId: opcion.zecatTypeId, zecatAreaId: opcion.zecatAreaId }
                : "ninguna",
            ];
          })
        )
      )
    );

    // La ventana de WhatsApp se abre ACA, en el gesto del click, y VACIA:
    // abrirla despues del await es exactamente lo que Safari iOS bloquea.
    // Cuando el servidor responde, se le asigna la URL real; si algo falla
    // o no hay numero, se cierra. Solo se abre si hay numero configurado.
    const waWindow = whatsappAvailable ? window.open("", "_blank") : null;

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof submitQuote>>;
      try {
        result = await submitQuote(formData);
      } catch (e) {
        waWindow?.close();
        setError("No se pudo enviar la cotización. Probá de nuevo.");
        throw e;
      }
      if (!result.success) {
        waWindow?.close();
        setError(result.error ?? "No se pudo enviar la cotización.");
        return;
      }

      // La cotizacion YA esta guardada: lo de WhatsApp es un extra y ningun
      // fallo de aca en adelante la pierde.
      if (result.waUrl) {
        if (waWindow) {
          waWindow.location.href = result.waUrl;
        } else {
          // El popup fue bloqueado igual (o no habia numero al cargar pero
          // si al enviar): la confirmacion muestra el boton como via segura.
        }
      } else {
        waWindow?.close();
      }

      clearQuoteCart();
      // Carrera rara pero posible: un producto pausado/eliminado entre que
      // se cargo la pagina y se envio. La confirmacion lo dice.
      setOmittedOnSubmit(result.omittedProducts ?? []);
      setWaUrl(result.waUrl ?? null);
      setShortCode(result.shortCode ?? null);
      setSubmitted(true);
    });
  }

  // Unidades por producto HOY (el cliente puede quitar lineas): la
  // personalizacion se cobra por unidad sobre el total del producto.
  const unidadesPorProducto = new Map<string, number>();
  for (const item of items) {
    unidadesPorProducto.set(
      item.productId,
      (unidadesPorProducto.get(item.productId) ?? 0) + item.quantity
    );
  }
  const impresionVisible = printing.flatMap((p) => {
    const quantity = unidadesPorProducto.get(p.productId);
    return quantity ? [{ printing: p, quantity }] : [];
  });
  // En centavos: el total es EXACTAMENTE la suma de las lineas mostradas.
  const totalImpresionCentavos = impresionVisible.reduce(
    (sum, { printing: p, quantity }) => {
      const o = p.opciones.find((x) => x.key === selecciones[p.productId]);
      return o
        ? sum +
            aCentavos(o.unitPrice) * quantity +
            aCentavos(o.setupPrice) +
            aCentavos(p.surcharge ?? 0)
        : sum;
    },
    0
  );
  const conImpresion = impresionVisible.filter(({ printing: p }) =>
    p.opciones.some((o) => o.key === selecciones[p.productId])
  ).length;
  // Personalizables sin precio en la tienda (CDO, o Zecat sin niveles): su
  // personalizacion se cotiza aparte. Los "Sin personalizar" elegidos no.
  const conOpciones = new Set(printing.map((p) => p.productId));
  const sinPrecio = new Set(
    items
      .filter((i) => i.personalizable && !conOpciones.has(i.productId))
      .map((i) => i.productId)
  ).size;
  const total =
    (items.reduce((sum, item) => sum + item.subtotalCentavos, 0) +
      totalImpresionCentavos) /
    100;

  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-3xl font-black tracking-tight text-foreground">
          Recibimos tu solicitud
        </h1>
        <p className="mt-4 text-foreground/70">
          Te contactamos a la brevedad para avanzar con tu cotización.
        </p>
        {shortCode && (
          <p className="mt-3 text-sm text-foreground/60">
            Tu número de cotización es{" "}
            <strong className="text-foreground">#{shortCode}</strong> —
            mencionalo si nos escribís.
          </p>
        )}
        {/* Boton SIEMPRE visible cuando hay link: la apertura automatica
            puede haber sido bloqueada por el navegador, y un click del
            usuario nunca se bloquea. */}
        {waUrl && (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
          >
            Enviar mi pedido por WhatsApp
          </a>
        )}
        {omittedOnSubmit.length > 0 && (
          <p className="mx-auto mt-6 max-w-md rounded-lg bg-accent/15 px-4 py-3 text-sm text-foreground/80">
            Ojo: {omittedOnSubmit.length === 1 ? "este producto dejó" : "estos productos dejaron"}{" "}
            de estar disponible{omittedOnSubmit.length === 1 ? "" : "s"} y no
            {omittedOnSubmit.length === 1 ? " entró" : " entraron"} en la
            cotización: <strong>{omittedOnSubmit.join(", ")}</strong>.
          </p>
        )}
        <Link
          href="/catalogo"
          className="mt-8 inline-block rounded-full bg-accent px-6 py-3 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
        >
          Volver al catálogo
        </Link>
      </div>
    );
  }

  if (loadingItems) {
    return <QuoteSkeleton />;
  }

  // La carga fallo o nunca respondio: error CON salida, nunca un skeleton
  // eterno. El pedido no se pierde — vive en localStorage.
  if (loadFailed) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-3xl font-black tracking-tight text-foreground">
          No pudimos cargar tu cotización
        </h1>
        <p className="mt-4 text-foreground/70">
          Tu pedido está guardado en este navegador — no se perdió nada.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            // Los resets van ACA y no dentro del efecto (setState sincrono
            // en un effect dispara renders en cascada y el lint lo marca).
            onClick={() => {
              setLoadFailed(false);
              setLoadingItems(true);
              setIntento((n) => n + 1);
            }}
            className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
          >
            Reintentar
          </button>
          <Link
            href="/catalogo"
            className="rounded-full border border-foreground/15 px-6 py-3 text-sm font-medium text-foreground/70 transition-colors hover:border-primary hover:text-primary"
          >
            Volver al catálogo
          </Link>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-3xl font-black tracking-tight text-foreground">
          Tu cotización está vacía
        </h1>
        {/* Caso especial: el borrador TENIA productos, pero todos dejaron de
            estar disponibles. Sin este aviso el cliente ve "vacía" y piensa
            que perdió el carrito. */}
        {unavailable.length > 0 && (
          <p className="mx-auto mt-6 max-w-md rounded-lg bg-accent/15 px-4 py-3 text-sm text-foreground/80">
            Los productos que tenías guardados dejaron de estar disponibles y
            los sacamos del pedido: <strong>{unavailable.join(", ")}</strong>.
          </p>
        )}
        <p className="mt-4 text-foreground/70">
          Agregá productos desde el catálogo para armar tu pedido.
        </p>
        <Link
          href="/catalogo"
          className="mt-8 inline-block rounded-full bg-accent px-6 py-3 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
        >
          Ver catálogo
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/catalogo"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground/60 transition-colors hover:text-primary"
      >
        ← Seguir eligiendo productos
      </Link>

      <h1 className="mt-4 text-4xl font-black tracking-tight text-foreground">
        Cotización
      </h1>
      <p className="mt-2 text-foreground/70">
        Revisá tu pedido y completá tus datos. No es una compra con pago
        inmediato: te contactamos con el boceto y el precio final.
      </p>

      {unavailable.length > 0 && (
        <p className="mt-6 rounded-lg bg-accent/15 px-4 py-3 text-sm text-foreground/80">
          {unavailable.length === 1
            ? "Un producto de tu pedido dejó"
            : "Algunos productos de tu pedido dejaron"}{" "}
          de estar disponible{unavailable.length === 1 ? "" : "s"} y{" "}
          {unavailable.length === 1 ? "lo sacamos" : "los sacamos"}:{" "}
          <strong>{unavailable.join(", ")}</strong>.
        </p>
      )}

      <div className="mt-10 flex flex-col gap-4">
        {items.map((item, index) => (
          <div
            key={`${item.productId}-${item.variantSku ?? "sin-variante"}`}
            className="flex items-center gap-4 border-b border-foreground/10 pb-4"
          >
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-foreground/5">
              {item.imageUrl && (
                <Image
                  src={item.imageUrl}
                  alt={item.productName}
                  fill
                  sizes="80px"
                  unoptimized={!isOptimizableImage(item.imageUrl)}
                  className="object-cover"
                />
              )}
            </div>

            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {item.productName}
              </p>
              {item.variantLabel && (
                <p className="text-xs text-foreground/60">
                  {item.variantLabel}
                </p>
              )}
              <p className="mt-1 text-xs text-foreground/60">
                {item.quantity} x {item.unitPriceLabel}
              </p>
              {!item.inStock && (
                <p className="mt-1 text-xs text-primary-dark">
                  Consultar disponibilidad
                </p>
              )}
            </div>

            <p className="text-sm font-medium text-foreground">
              {item.subtotalLabel}
            </p>

            <button
              type="button"
              onClick={() => handleRemove(index)}
              className="text-xs font-medium text-foreground/50 transition-colors hover:text-primary"
            >
              Quitar
            </button>
          </div>
        ))}
      </div>

      {impresionVisible.length > 0 && (
        <div className="mt-8 flex flex-col gap-4">
          <h2 className="text-lg font-medium text-foreground">
            Personalización
          </h2>
          {impresionVisible.map(({ printing: p, quantity }) => (
            <QuotePrintingPicker
              key={p.productId}
              printing={p}
              quantity={quantity}
              seleccion={selecciones[p.productId] ?? "ninguna"}
              onChange={(v) => handleSeleccion(p.productId, v)}
            />
          ))}
        </div>
      )}

      <p className="mt-6 text-right text-lg font-medium text-foreground">
        Total: {formatPriceArsCentavos(total)}{" "}
        <span className="text-sm text-foreground/50">+ IVA</span>
      </p>
      <p className="mt-1 text-right text-xs text-foreground/50">
        {leyendaTotalCotizar(
          impresionEnTotal({ conImpresion, sinPrecio })
        )}
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-12 flex flex-col gap-6 border-t border-foreground/10 pt-10"
      >
        <h2 className="text-2xl font-medium text-foreground">Tus datos</h2>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Field label="Nombre" required>
            <input
              type="text"
              name="customerName"
              required
              className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
          </Field>

          <Field label="Empresa">
            <input
              type="text"
              name="companyName"
              className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
          </Field>

          <Field label="Email" required>
            <input
              type="email"
              name="customerEmail"
              required
              className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
          </Field>

          <Field label="Teléfono">
            <input
              type="tel"
              name="customerPhone"
              // El autocompletado del navegador llego a concatenar digitos
              // de otro campo y guardamos un telefono de 13 digitos. El
              // servidor valida igual (esto es comodidad, no seguridad).
              autoComplete="tel"
              inputMode="tel"
              maxLength={25}
              placeholder="351 235-0995"
              className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
          </Field>
        </div>

        <Field label="Logo / arte (opcional)">
          <input
            type="file"
            name="logo"
            accept=".png,.jpg,.jpeg,.pdf,.svg,.ai,.eps"
            className="text-sm text-foreground/70 file:mr-4 file:rounded-full file:border-0 file:bg-foreground/5 file:px-4 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-foreground/10"
          />
          <p className="mt-1 text-xs text-foreground/50">
            Podés subirlo ahora o enviárnoslo después por email o WhatsApp.
            Formatos aceptados: PNG, JPG, PDF, SVG, AI, EPS (máximo 15MB).
          </p>
        </Field>

        <Field label="Notas (opcional)">
          <textarea
            name="notes"
            rows={4}
            className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
        </Field>

        {/* Checkbox obligatorio (antes era solo un texto informativo). Los
            datos son los indispensables para responder, pero se guardan y se
            procesan en servidores fuera de Argentina, y esa transferencia
            necesita un consentimiento expreso que un "al enviar aceptás" no
            da. El servidor valida igual: `required` es comodidad, no
            seguridad (la Server Action es un endpoint).

            El link abre en otra pestaña para que leer la política no haga
            perder lo que el cliente ya cargó en el formulario.

            Sin marcar, `required` sigue frenando el envío, pero el globito
            nativo se reemplaza por un aviso propio: `preventDefault()` en el
            evento `invalid` suprime SOLO el de este campo (nombre y email
            conservan el suyo). Como sin el globito el navegador tampoco lleva
            el foco, se lo lleva a mano. */}
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-3 text-sm text-foreground/80">
            <input
              type="checkbox"
              name="privacyAccepted"
              required
              aria-invalid={privacyMissing}
              aria-describedby={privacyMissing ? "privacy-error" : undefined}
              onInvalid={(event) => {
                event.preventDefault();
                setPrivacyMissing(true);
                event.currentTarget.focus();
              }}
              onChange={(event) => {
                if (event.currentTarget.checked) setPrivacyMissing(false);
              }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span>
              Leí y acepto la{" "}
              <Link
                href="/privacidad"
                target="_blank"
                rel="noopener"
                className="text-primary underline underline-offset-2 transition-colors hover:text-primary-light"
              >
                Política de privacidad
              </Link>
              <span className="text-primary"> *</span>
            </span>
          </label>
          {privacyMissing && (
            <p
              id="privacy-error"
              role="alert"
              className="ml-7 text-xs font-medium text-primary-dark"
            >
              Para enviar la solicitud tenés que aceptar la Política de
              privacidad.
            </p>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-primary-dark/5 px-4 py-3 text-sm text-primary-dark">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          data-cta-principal
          className="self-start rounded-full bg-accent px-8 py-3.5 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {isPending ? "Enviando..." : "Enviar solicitud de cotización"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-primary"> *</span>}
      </span>
      {children}
    </label>
  );
}

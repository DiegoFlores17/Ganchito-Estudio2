"use client";

import {
  useEffect,
  type FormEvent,
  type ReactNode,
  useState,
  useTransition,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { QuoteSkeleton } from "@/components/quote-skeleton";
import { formatPriceArs } from "@/lib/format";
import {
  clearQuoteCart,
  getQuoteCart,
  removeFromQuoteCart,
} from "@/lib/quote-cart";
import {
  getQuoteItemsSummary,
  submitQuote,
  type QuoteItemSummary,
} from "./actions";

export default function CotizarPage() {
  const [items, setItems] = useState<QuoteItemSummary[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const cart = getQuoteCart();
    getQuoteItemsSummary(cart).then((summary) => {
      setItems(summary);
      setLoadingItems(false);
    });
  }, []);

  function handleRemove(index: number) {
    removeFromQuoteCart(index);
    setItems((prev) => prev.filter((_, i) => i !== index));
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

    startTransition(async () => {
      const result = await submitQuote(formData);
      if (!result.success) {
        setError(result.error ?? "No se pudo enviar la cotizacion.");
        return;
      }
      clearQuoteCart();
      setSubmitted(true);
    });
  }

  const total = items.reduce((sum, item) => sum + item.subtotal, 0);

  // Minimo de personalizacion del proveedor: es por PRODUCTO, no por linea.
  // Si el mismo producto tiene varias lineas (distintos color/talle, de una
  // sola visita o de varias), hay que sumarlas todas antes de comparar
  // contra el minimo — por eso se agrupa por productId aca, sobre el estado
  // ACTUAL de items (asi tambien refleja lineas que el cliente saco con
  // "Quitar").
  const belowMinimum = (() => {
    const totals = new Map<
      string,
      { productName: string; total: number; min: number }
    >();
    for (const item of items) {
      if (!item.minOrderQuantity) continue;
      const entry = totals.get(item.productId) ?? {
        productName: item.productName,
        total: 0,
        min: item.minOrderQuantity,
      };
      entry.total += item.quantity;
      totals.set(item.productId, entry);
    }
    return [...totals.values()].filter((p) => p.total < p.min);
  })();

  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-3xl font-black tracking-tight text-foreground">
          Recibimos tu solicitud
        </h1>
        <p className="mt-4 text-foreground/70">
          Te contactamos a la brevedad para avanzar con tu cotizacion.
        </p>
        <Link
          href="/catalogo"
          className="mt-8 inline-block rounded-full bg-accent px-6 py-3 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
        >
          Volver al catalogo
        </Link>
      </div>
    );
  }

  if (loadingItems) {
    return <QuoteSkeleton />;
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-3xl font-black tracking-tight text-foreground">
          Tu cotizacion esta vacia
        </h1>
        <p className="mt-4 text-foreground/70">
          Agrega productos desde el catalogo para armar tu pedido.
        </p>
        <Link
          href="/catalogo"
          className="mt-8 inline-block rounded-full bg-accent px-6 py-3 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
        >
          Ver catalogo
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
        Cotizacion
      </h1>
      <p className="mt-2 text-foreground/70">
        Revisa tu pedido y completa tus datos. No es una compra con pago
        inmediato: te contactamos con el boceto y el precio final.
      </p>

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

      {belowMinimum.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          {belowMinimum.map((p) => (
            <p
              key={p.productName}
              className="rounded-lg border border-accent-hover/50 bg-accent/15 px-4 py-3 text-sm text-foreground"
            >
              <span className="font-medium">{p.productName}</span> tiene un
              minimo de {p.min} unidades y llevas {p.total}. Podes ajustar las
              cantidades o enviar la cotizacion igual — lo vemos juntos.
            </p>
          ))}
        </div>
      )}

      <p className="mt-4 text-right text-lg font-medium text-foreground">
        Total: {formatPriceArs(total)}{" "}
        <span className="text-sm text-foreground/50">+ IVA</span>
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

          <Field label="Telefono">
            <input
              type="tel"
              name="customerPhone"
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
            Podes subirlo ahora o enviarnoslo despues por email o WhatsApp.
            Formatos aceptados: PNG, JPG, PDF, SVG, AI, EPS (maximo 15MB).
          </p>
        </Field>

        <Field label="Notas (opcional)">
          <textarea
            name="notes"
            rows={4}
            className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-primary-dark/5 px-4 py-3 text-sm text-primary-dark">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-full bg-accent px-8 py-3.5 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {isPending ? "Enviando..." : "Enviar solicitud de cotizacion"}
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

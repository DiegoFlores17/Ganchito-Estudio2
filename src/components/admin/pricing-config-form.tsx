"use client";

import { useState, useTransition, type FormEvent } from "react";
import { updatePricingConfig } from "@/app/admin/(panel)/configuracion/actions";

export function PricingConfigForm({
  defaultMarginPercent,
  vatPercent,
  usdRate,
}: {
  defaultMarginPercent: number;
  vatPercent: number;
  usdRate: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // onSubmit + preventDefault: si el servidor rechaza el valor, no
    // queremos que el formulario se resetee y pierda lo que se tipeo.
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await updatePricingConfig(formData);
      if (!result.success) {
        setError(result.error ?? "No se pudo guardar.");
        return;
      }
      setSaved(true);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex max-w-md flex-col gap-6 rounded-xl border border-foreground/10 bg-background p-6"
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">
          Margen global (%)
        </label>
        <input
          type="number"
          name="defaultMarginPercent"
          step="0.01"
          min="0"
          defaultValue={defaultMarginPercent}
          required
          className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
        <p className="text-xs text-foreground/50">
          Precio de venta = costo x (1 + margen/100). Hoy: costo x{" "}
          {(1 + defaultMarginPercent / 100).toFixed(2)}.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">IVA (%)</label>
        <input
          type="number"
          name="vatPercent"
          step="0.01"
          min="0"
          defaultValue={vatPercent}
          required
          className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
        <p className="text-xs text-foreground/50">
          Se muestra siempre aparte del precio base (&quot;+ IVA&quot;), nunca embebido.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">
          Cotización del dólar
        </label>
        <input
          type="number"
          name="usdRate"
          step="0.01"
          min="0.01"
          defaultValue={usdRate}
          required
          className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
        <p className="text-xs text-foreground/50">
          Para los proveedores que cotizan en dólares. Usá la cotización del
          proveedor, no la del mercado: es la que ellos facturan. Al cambiarla,
          esos precios se actualizan solos — no hace falta re-sincronizar.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-primary-dark/5 px-4 py-2 text-sm text-primary-dark">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="rounded-lg bg-primary/5 px-4 py-2 text-sm text-primary">
          Guardado.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {isPending ? "Guardando..." : "Guardar cambios"}
      </button>
    </form>
  );
}

"use client";

import { useState, useTransition, type FormEvent } from "react";
import { updateFeaturedConfig } from "@/app/admin/(panel)/destacados/actions";

export function FeaturedRangeForm({
  priceMin,
  priceMax,
}: {
  priceMin: number;
  priceMax: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Un aviso describe el resultado de una accion sobre un estado dado: al
  // tocar el formulario ese estado cambia, asi que se limpia (mismo criterio
  // que PricingConfigForm).
  function limpiarAvisos() {
    setSaved(false);
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // preventDefault: si el servidor rechaza el valor, el formulario no se
    // resetea y no se pierde lo que se tipeo.
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await updateFeaturedConfig(formData);
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
      onChange={limpiarAvisos}
      className="flex max-w-md flex-col gap-5 rounded-xl border border-foreground/10 bg-background p-4 sm:p-6"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="priceMin" className="text-sm font-medium text-foreground">
          Precio mínimo ($)
        </label>
        <input
          id="priceMin"
          type="text"
          name="priceMin"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={priceMin}
          required
          className="w-full rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="priceMax" className="text-sm font-medium text-foreground">
          Precio máximo ($)
        </label>
        <input
          id="priceMax"
          type="text"
          name="priceMax"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={priceMax}
          required
          className="w-full rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
        <p className="text-xs text-foreground/50">
          Pesos enteros (5000 o 5.000). Precio de venta de 1 unidad, sin IVA:
          el mismo número que muestra la card de la tienda.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-primary-dark/5 px-4 py-2 text-sm text-primary-dark">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="rounded-lg bg-primary/5 px-4 py-2 text-sm text-primary">
          Guardado. La portada se actualiza sola.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {isPending ? "Guardando..." : "Guardar rango"}
      </button>
    </form>
  );
}

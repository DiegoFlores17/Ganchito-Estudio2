"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  refreshUsdRateNow,
  updatePricingConfig,
} from "@/app/admin/(panel)/configuracion/actions";

export function PricingConfigForm({
  defaultMarginPercent,
  vatPercent,
  usdRate,
  usdRateMode,
  usdRateSource,
  usdRateUpdatedAt,
  usdRateOfficial,
  usdRateOfficialAt,
}: {
  defaultMarginPercent: number;
  vatPercent: number;
  usdRate: number;
  usdRateMode: "AUTO" | "MANUAL";
  usdRateSource: string | null;
  /// Ya formateadas en el servidor: los Date no cruzan lindo a un client
  /// component y ademas el formato de fecha tiene que ser el mismo en los dos
  /// lados para no ver un salto al hidratar.
  usdRateUpdatedAt: string | null;
  usdRateOfficial: number | null;
  usdRateOfficialAt: string | null;
}) {
  const [modo, setModo] = useState(usdRateMode);
  const [consultando, setConsultando] = useState(false);
  const [avisoDolar, setAvisoDolar] = useState<string | null>(null);
  const router = useRouter();

  // Solo tiene sentido avisar de la diferencia en MANUAL: en AUTO el valor ES
  // el oficial. Se marca a partir de medio punto para no molestar por el
  // redondeo.
  const diferencia =
    usdRateOfficial && usdRate
      ? ((usdRateOfficial - usdRate) / usdRate) * 100
      : null;
  const hayDiferencia =
    modo === "MANUAL" && diferencia !== null && Math.abs(diferencia) >= 0.5;

  async function consultarAhora() {
    setConsultando(true);
    setAvisoDolar(null);
    const r = await refreshUsdRateNow();
    setConsultando(false);

    if (r.status === "sin-respuesta") {
      setAvisoDolar(
        `No se pudo consultar la cotización (${r.motivo}). Quedó el último valor conocido.`
      );
    } else if (r.status === "rechazado") {
      setAvisoDolar(
        `Se descartó el valor que devolvió la API porque ${r.motivo}. Quedó el último valor conocido.`
      );
    } else if (r.status === "aplicado") {
      setAvisoDolar(`Cotización actualizada: ${r.anterior} → ${r.valor}.`);
    } else {
      setAvisoDolar(
        `El oficial hoy es ${r.valor}. No se aplicó porque la cotización está en modo manual.`
      );
    }
    router.refresh();
  }

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

      <div className="flex flex-col gap-3 rounded-lg border border-foreground/10 p-4">
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
          // readOnly y NO disabled. Se ve igual, pero un input `disabled`
          // **no se envía con el formulario**: al pasar a Automática, usdRate
          // llegaba vacío al servidor, Number(null) daba 0 y la validación lo
          // rechazaba con "tiene que ser un número mayor a 0".
          //
          // En AUTO no se edita a mano porque el próximo job lo pisaría sin
          // avisar; el valor viaja igual para que la validación lo acepte, y
          // después refreshUsdRate() lo reemplaza por el oficial.
          readOnly={modo === "AUTO"}
          className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary read-only:bg-foreground/[0.04] read-only:text-foreground/50 read-only:focus:border-foreground/15"
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Modo de actualización</legend>
          {(
            [
              ["MANUAL", "Fija", "El valor no cambia hasta que lo edites."],
              [
                "AUTO",
                "Automática",
                "Se actualiza sola con el dólar oficial del Banco Nación.",
              ],
            ] as const
          ).map(([valor, titulo, ayuda]) => (
            <label key={valor} className="flex items-start gap-2.5 text-sm">
              <input
                type="radio"
                name="usdRateMode"
                value={valor}
                checked={modo === valor}
                onChange={() => setModo(valor)}
                className="mt-1 accent-[var(--color-primary)]"
              />
              <span>
                <span className="font-medium text-foreground">{titulo}</span>
                <span className="block text-xs text-foreground/50">{ayuda}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1 border-t border-foreground/10 pt-3 text-xs text-foreground/50">
          <p>
            Valor actual: <strong className="text-foreground/70">{usdRate}</strong>
            {usdRateSource && <> · origen: {usdRateSource}</>}
            {usdRateUpdatedAt && <> · {usdRateUpdatedAt}</>}
          </p>
          {usdRateOfficial !== null && (
            <p>
              Oficial del Banco Nación:{" "}
              <strong className="text-foreground/70">{usdRateOfficial}</strong>
              {usdRateOfficialAt && <> · consultado {usdRateOfficialAt}</>}
            </p>
          )}
          {usdRateOfficial === null && (
            <p>Todavía no se consultó la cotización oficial.</p>
          )}
        </div>

        {hayDiferencia && (
          <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-primary">
            El oficial está {diferencia! > 0 ? "por encima" : "por debajo"} del
            valor cargado ({diferencia! > 0 ? "+" : ""}
            {diferencia!.toFixed(2)}%). Como la cotización está fija, los
            precios no se movieron.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={consultarAhora}
            disabled={consultando}
            className="rounded-full border border-foreground/15 px-4 py-2 text-xs font-medium text-foreground/80 transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {consultando ? "Consultando..." : "Consultar cotización ahora"}
          </button>
          {avisoDolar && (
            <span className="text-xs text-foreground/60">{avisoDolar}</span>
          )}
        </div>

        <p className="text-xs text-foreground/50">
          Se usa para los proveedores que cotizan en dólares (hoy CDO). Al
          cambiarla, esos precios se actualizan solos — no hace falta
          re-sincronizar.
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

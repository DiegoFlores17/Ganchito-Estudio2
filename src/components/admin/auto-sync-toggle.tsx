"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductOrigin } from "@prisma/client";
import { setAutoSync } from "@/app/admin/(panel)/proveedores/actions";

/// Interruptor del sync automatico de un proveedor. Lo ve cualquier admin
/// (saber si el catalogo se actualiza solo es informacion de todos los
/// dias); solo un super-admin lo cambia.
export function AutoSyncToggle({
  provider,
  activado,
  horarios,
  puedeCambiar,
}: {
  provider: ProductOrigin;
  activado: boolean;
  /// Texto de las ventanas, ej. "06:00 y 18:00".
  horarios: string;
  puedeCambiar: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cambiar() {
    setError(null);
    startTransition(async () => {
      const r = await setAutoSync(provider, !activado);
      if (!r.success) setError(r.error ?? "No se pudo cambiar.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-background p-5 text-sm">
      <div>
        <p className="font-medium text-foreground">Sincronización automática</p>
        <p className="mt-1 text-foreground/60">
          {activado
            ? `Activada: corre sola todos los días a las ${horarios}.`
            : "Apagada: el catálogo solo se actualiza con «Sincronizar ahora»."}
        </p>
        {error && <p className="mt-1 text-red-600">{error}</p>}
      </div>
      {puedeCambiar && (
        <button
          type="button"
          role="switch"
          aria-checked={activado}
          aria-label="Sincronización automática"
          onClick={cambiar}
          disabled={pendiente}
          className={
            "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 " +
            (activado ? "bg-primary" : "bg-foreground/20")
          }
        >
          <span
            className={
              "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all " +
              (activado ? "left-6" : "left-1")
            }
          />
        </button>
      )}
    </div>
  );
}

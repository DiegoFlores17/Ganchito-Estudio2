"use client";

import { useState, useTransition } from "react";
import { refrescarTienda } from "@/app/admin/(panel)/configuracion/actions";

/// Botón «Refrescar tienda»: tira la cache pública (precios, catálogo, menú,
/// fichas y contacto). Solo lo ve un super admin (la página y la acción lo
/// exigen).
export function RefrescarTiendaButton() {
  const [pendiente, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);

  function refrescar() {
    setMensaje(null);
    startTransition(async () => {
      try {
        const r = await refrescarTienda();
        setMensaje(
          r.success
            ? "Listo: la tienda se actualiza en la próxima visita."
            : "No se pudo refrescar."
        );
      } catch {
        setMensaje("No se pudo refrescar.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={refrescar}
        disabled={pendiente}
        className="rounded-full border border-foreground/20 px-5 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
      >
        {pendiente ? "Refrescando…" : "Refrescar tienda"}
      </button>
      {mensaje && (
        <p role="status" className="text-sm text-foreground/70">
          {mensaje}
        </p>
      )}
    </div>
  );
}

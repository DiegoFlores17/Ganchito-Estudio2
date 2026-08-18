"use client";

import { useEffect } from "react";

/// Pantalla de error del panel.
///
/// Mas seca que la de la tienda a proposito: acá el que la ve es del equipo,
/// no un cliente. Lo que importa es el codigo de referencia para cruzarlo con
/// los logs, no el tono.
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Error en el panel:", error);
  }, [error]);

  return (
    <div className="rounded-xl border border-foreground/10 bg-background p-8">
      <h1 className="text-2xl font-medium text-foreground">
        No se pudo cargar esta pantalla
      </h1>
      <p className="mt-2 text-sm text-foreground/60">
        Suele ser la base de datos sin responder por un momento. Reintentá; si
        persiste, revisá los logs con el código de abajo.
      </p>

      <button
        type="button"
        // Ver la nota en global-error.tsx: la arrow evita pasarle el evento
        // de click a retry(), que no espera argumentos.
        onClick={() => retry()}
        className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
      >
        Reintentar
      </button>

      {error.digest && (
        <p className="mt-6 text-xs text-foreground/40">
          Código de referencia: {error.digest}
        </p>
      )}
    </div>
  );
}

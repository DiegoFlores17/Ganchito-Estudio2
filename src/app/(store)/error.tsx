"use client";

import { useEffect } from "react";
import Link from "next/link";

/// Pantalla de error de la tienda publica.
///
/// Cubre cualquier fallo al renderizar una pagina de la tienda: la caida mas
/// probable es que Neon no responda. Antes de esto, el cliente veia la
/// pantalla de error generica de Next, sin marca y en ingles.
///
/// Se usa retry() y no reset(): reset() limpia el estado del boundary pero NO
/// vuelve a pedir los datos, asi que ante una base caida re-renderizaria el
/// mismo error. retry() reintenta el fetch, que es lo unico util cuando la
/// causa es temporal. (retry es estable desde Next 16.3.)
export default function StoreError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Queda en los logs del servidor de Vercel, con el mismo digest que ve el
    // cliente: asi un reporte de "me tiro error" se puede cruzar con el log.
    console.error("Error en la tienda:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-6 px-6 py-28 sm:items-center sm:text-center">
      <h1 className="text-4xl font-black tracking-tight text-foreground">
        Se nos rompio algo
      </h1>

      <p className="text-foreground/70">
        No pudimos cargar esta pagina. Suele ser algo pasajero: proba de nuevo
        en un momento. Si sigue apareciendo, escribinos y lo vemos.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={retry}
          className="rounded-full bg-primary px-7 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
        >
          Reintentar
        </button>
        <Link
          href="/catalogo"
          className="rounded-full border border-foreground/15 px-7 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
        >
          Ir al catalogo
        </Link>
      </div>

      {error.digest && (
        <p className="text-xs text-foreground/40">
          Codigo de referencia: {error.digest}
        </p>
      )}
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductOrigin } from "@prisma/client";
import {
  advanceSync,
  startSync,
  type SyncProgress,
} from "@/app/admin/(panel)/proveedores/actions";

/// Card de un proveedor con su boton de sincronizacion. El NAVEGADOR
/// conduce el loop de batches: cada llamada a advanceSync procesa una
/// pagina y devuelve el progreso. Cerrar la pestaña detiene el loop y la
/// corrida queda retomable (el proximo click sigue desde el cursor).
///
/// El disabled del boton es UX. La proteccion real contra doble click, dos
/// pestañas o boton + consola es el lock en la base (ver lib/sync-run.ts).
export function SyncProviderCard({
  provider,
  nombre,
  descripcion,
}: {
  provider: ProductOrigin;
  nombre: string;
  descripcion: string;
}) {
  const router = useRouter();
  const [corriendo, setCorriendo] = useState(false);
  const [progreso, setProgreso] = useState<SyncProgress | null>(null);
  const [resultado, setResultado] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Evita que un loop viejo siga escribiendo estado si el componente se
  // desmonta o se lanza otro.
  const loopActivo = useRef(0);

  async function sincronizar() {
    setError(null);
    setResultado(null);
    setProgreso(null);
    setCorriendo(true);
    const miLoop = ++loopActivo.current;

    try {
      const inicio = await startSync(provider);
      if (!inicio.success || !inicio.runId) {
        setError(inicio.error ?? "No se pudo iniciar la sincronización.");
        setCorriendo(false);
        return;
      }

      let page = inicio.nextPage ?? 1;
      for (;;) {
        const p = await advanceSync(inicio.runId, page);
        if (loopActivo.current !== miLoop) return; // desmonte o loop nuevo
        setProgreso(p);
        if (p.done) {
          setResultado(p);
          break;
        }
        page++;
      }
      // Refresca el historial server-rendered de abajo.
      router.refresh();
    } catch (e) {
      if (loopActivo.current !== miLoop) return;
      setError(e instanceof Error ? e.message : "La sincronización falló.");
      router.refresh();
    } finally {
      if (loopActivo.current === miLoop) setCorriendo(false);
    }
  }

  const pct =
    progreso?.totalPages && progreso.totalPages > 0
      ? Math.round((progreso.page / progreso.totalPages) * 100)
      : 0;

  return (
    <div className="rounded-xl border border-foreground/10 bg-background p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-medium text-foreground">{nombre}</p>
          <p className="text-xs text-foreground/50">{descripcion}</p>
        </div>
        <button
          type="button"
          onClick={sincronizar}
          disabled={corriendo}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {corriendo ? "Sincronizando..." : "Sincronizar ahora"}
        </button>
      </div>

      {corriendo && progreso && (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-foreground/60">
            Página {progreso.page} de {progreso.totalPages ?? "?"} — creados{" "}
            {progreso.created}, actualizados {progreso.updated}
            {progreso.paused > 0 && <>, pausados {progreso.paused}</>}
            {progreso.failed > 0 && <>, fallidos {progreso.failed}</>}
          </p>
          <p className="mt-1 text-xs text-foreground/40">
            No cierres esta pestaña. Si se corta, el próximo click retoma
            desde donde quedó.
          </p>
        </div>
      )}

      {resultado && (
        <div className="mt-4 rounded-lg bg-primary/5 px-4 py-3 text-sm text-foreground/80">
          <p className="font-medium text-foreground">
            Sincronización completa
          </p>
          <p className="mt-1">
            {resultado.created} creados · {resultado.updated} actualizados ·{" "}
            {resultado.paused} pausados · {resultado.failed} fallidos
            {resultado.usdWarnings > 0 && (
              <> · {resultado.usdWarnings} con currency USD (ignorada)</>
            )}
          </p>
          {(resultado.missingExternalIds?.length ?? 0) > 0 && (
            <p className="mt-1 text-primary-dark">
              {resultado.missingExternalIds!.length} producto(s) activos que el
              proveedor ya no devuelve — revisalos en el historial de abajo.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-primary-dark/5 px-4 py-3 text-sm text-primary-dark">
          {error}
        </p>
      )}
    </div>
  );
}

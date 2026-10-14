"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductOrigin } from "@prisma/client";
import {
  syncTick,
  type SyncTickResult,
} from "@/app/admin/(panel)/proveedores/actions";
import { SyncRunSummaryLine } from "@/components/admin/sync-run-summary";

/// Cuanto esperar antes de reintentar cuando otro (el cron, otra pestaña,
/// la consola) tiene la corrida en este momento.
const ESPERA_SI_OCUPADO_MS = 5_000;

/// Card de un proveedor con su boton de sincronizacion. El navegador llama
/// a syncTick en loop: cada llamada avanza ~45 s de la corrida y devuelve el
/// progreso. El trabajo vive en la base (lista congelada + cursor), no aca:
/// cerrar la pestaña no pierde nada, y lo que falte lo sigue el proximo
/// click o el sync automatico (si esta activado).
///
/// El disabled del boton es UX. La proteccion real contra doble click, dos
/// pestañas o boton + cron + consola es el lease de la corrida (ver
/// lib/sync/motor.ts).
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
  const [progreso, setProgreso] = useState<SyncTickResult | null>(null);
  const [resultado, setResultado] = useState<SyncTickResult | null>(null);
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
    let siguiendo: string | undefined;

    try {
      for (;;) {
        const r = await syncTick(provider, siguiendo);
        if (loopActivo.current !== miLoop) return; // desmonte o loop nuevo
        if (r.runId) siguiendo = r.runId;

        if (r.estado === "completa") {
          setResultado(r);
          break;
        }
        if (r.estado === "fallo" || r.estado === "sin-corrida") {
          setError(r.error ?? "La sincronización falló.");
          break;
        }
        setProgreso(r);
        if (r.estado === "ocupado") {
          await new Promise((resolve) => setTimeout(resolve, ESPERA_SI_OCUPADO_MS));
          if (loopActivo.current !== miLoop) return;
        }
      }
      // Refresca el estado y el historial server-rendered.
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
    progreso?.total && progreso.total > 0
      ? Math.round(((progreso.procesados ?? 0) / progreso.total) * 100)
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
            {progreso.estado === "ocupado" ? "En curso" : "Sincronizando"} (
            {progreso.origen}): {progreso.procesados ?? 0} de{" "}
            {progreso.total ?? "?"} productos
            {progreso.estado === "ocupado" && " — la está procesando otro, esperando…"}
          </p>
          <p className="mt-1 text-xs text-foreground/40">
            Podés cerrar esta pestaña: el avance queda guardado y lo que falte
            lo sigue el próximo click o la sincronización automática.
          </p>
        </div>
      )}

      {resultado && (
        <div className="mt-4 rounded-lg bg-primary/5 px-4 py-3 text-sm text-foreground/80">
          <p className="font-medium text-foreground">
            Sincronización completa
          </p>
          {/* Mismo resumen fijo que guarda la corrida y lee el historial de
              abajo: la card y la fila no pueden mostrar cifras distintas. */}
          {resultado.summary ? (
            <SyncRunSummaryLine summary={resultado.summary} />
          ) : (
            <p className="mt-1 text-xs text-foreground/50">
              El detalle está en el historial de abajo.
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

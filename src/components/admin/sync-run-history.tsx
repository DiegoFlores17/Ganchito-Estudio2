"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SyncRunSummary } from "@/lib/sync-run";
import { pausarAusentes } from "@/app/admin/(panel)/proveedores/actions";
import {
  SyncRunSummaryDetail,
  SyncRunSummaryLine,
} from "@/components/admin/sync-run-summary";

export interface RunView {
  id: string;
  status: string;
  /// Origen legible: "panel, alguien@…", "consola", "automática".
  origen: string;
  startedAt: string;
  finishedAt: string | null;
  /// Resumen fijo de la corrida. Null en las anteriores a ese registro: se
  /// muestra "no registrado" y NO se recalcula desde el estado actual.
  summary: SyncRunSummary | null;
  /// Ids pausados despues del cierre con "Pausar estos N".
  pausadosDespues: string[];
  /// Solo en la ultima corrida completa con el umbral frenado: cuantos
  /// ausentes siguen sin resolver (el boton aparece si es > 0).
  pendientesDePausar: number;
  errors: Array<{ externalId: string; message: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  RUNNING: "En curso",
  DONE: "Completa",
  FAILED: "Fallida",
};

/// Historial de corridas con el detalle expandible. Cada corrida tiene un
/// ancla (#corrida-{id}): el mail del umbral linkea directo a la suya.
export function SyncRunHistory({
  runs,
  proveedor,
}: {
  runs: RunView[];
  /// Nombre visible del proveedor, para los textos del resumen.
  proveedor?: string;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <p className="mt-3 text-sm text-foreground/50">
        Todavía no hay ninguna corrida registrada.
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {runs.map((run) => {
        const expandida = abierta === run.id;
        return (
          <div
            key={run.id}
            id={`corrida-${run.id}`}
            className="scroll-mt-6 rounded-lg border border-foreground/10 bg-background px-4 py-3 text-sm target:border-primary target:ring-2 target:ring-primary/30"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-foreground/70">
                {run.startedAt} · {run.origen}
              </span>
              <span
                className={
                  run.status === "FAILED"
                    ? "font-medium text-primary-dark"
                    : run.status === "RUNNING"
                      ? "font-medium text-primary"
                      : "text-foreground/60"
                }
              >
                {STATUS_LABEL[run.status] ?? run.status}
              </span>
            </div>

            {run.summary ? (
              <SyncRunSummaryLine
                summary={run.summary}
                pausadosDespues={run.pausadosDespues.length}
                proveedor={proveedor}
              />
            ) : (
              run.status === "DONE" && (
                <p className="mt-1 text-xs text-foreground/40">
                  Resumen no registrado (corrida anterior a este registro).
                  {run.pausadosDespues.length > 0 && (
                    <span className="text-primary-dark">
                      {" "}
                      {run.pausadosDespues.length} pausados desde el panel.
                    </span>
                  )}
                </p>
              )
            )}

            {run.pendientesDePausar > 0 && (
              <PausarAusentes runId={run.id} pendientes={run.pendientesDePausar} />
            )}

            {(run.summary || run.errors.length > 0 || run.pausadosDespues.length > 0) && (
              <button
                type="button"
                onClick={() => setAbierta(expandida ? null : run.id)}
                className="mt-1 text-xs font-medium text-primary hover:text-primary-dark"
              >
                {expandida ? "Ocultar detalle" : "Ver detalle"}
              </button>
            )}
            {expandida && (
              <div className="mt-2 flex flex-col gap-2 border-t border-foreground/10 pt-2 text-xs">
                {run.summary ? (
                  <SyncRunSummaryDetail
                    summary={run.summary}
                    pausadosDespues={run.pausadosDespues}
                    proveedor={proveedor}
                  />
                ) : (
                  run.pausadosDespues.length > 0 && (
                    <div>
                      <p className="font-medium text-foreground/70">
                        Pausados desde el panel:
                      </p>
                      <p className="text-foreground/60">
                        {run.pausadosDespues.join(", ")}
                      </p>
                    </div>
                  )
                )}
                {run.errors.length > 0 && (
                  <div>
                    {/* Errores de productos, el error que corto la corrida,
                        y notas de lo que paso despues (retome, "Pausar
                        estos N"). */}
                    <p className="font-medium text-foreground/70">
                      Errores y notas:
                    </p>
                    {run.errors.map((e, i) => (
                      <p key={i} className="break-all text-foreground/60">
                        [{e.externalId}] {e.message.slice(0, 300)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/// Boton "Pausar estos N". Antes de pausar, el servidor vuelve a consultar
/// cada producto al proveedor: solo pausa los que confirma como baja.
function PausarAusentes({ runId, pendientes }: { runId: string; pendientes: number }) {
  const router = useRouter();
  const [pausando, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);

  function pausar() {
    setMensaje(null);
    startTransition(async () => {
      const r = await pausarAusentes(runId);
      if (!r.success) {
        setMensaje(r.error ?? "No se pudo pausar.");
        return;
      }
      setMensaje(
        `${r.pausados} pausados.` +
          (r.aRevisar ? ` ${r.aRevisar} siguen publicados en el proveedor: quedan a revisar.` : "") +
          (r.noVerificados
            ? ` ${r.noVerificados} no se pudieron verificar: no se pausaron, probá de nuevo más tarde.`
            : "") +
          (r.restantes
            ? ` Quedan ${r.restantes} pendientes: volvé a tocar el botón para seguir.`
            : "")
      );
      router.refresh();
    });
  }

  return (
    <div className="mt-2 rounded-lg bg-primary/5 px-3 py-2 text-xs">
      <p className="text-foreground/70">
        Antes de pausar se consulta cada producto al proveedor: solo se pausan
        los que confirma como dados de baja.
      </p>
      <button
        type="button"
        onClick={pausar}
        disabled={pausando}
        className="mt-2 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {pausando ? "Verificando y pausando..." : `Pausar estos ${pendientes}`}
      </button>
      {mensaje && <p className="mt-2 text-foreground/70">{mensaje}</p>}
    </div>
  );
}

"use client";

import { useState } from "react";

interface RunView {
  id: string;
  status: string;
  startedBy: string;
  startedAt: string;
  finishedAt: string | null;
  created: number;
  updated: number;
  paused: number;
  failed: number;
  usdWarnings: number;
  missing: Array<{ id: string; nombre: string; activo: boolean }>;
  errors: Array<{ externalId: string; message: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  RUNNING: "En curso",
  DONE: "Completa",
  FAILED: "Fallida",
};

/// Historial de corridas con el detalle (ausentes y errores) expandible.
/// Client component solo por el toggle de expansion — los datos llegan del
/// server ya formateados.
export function SyncRunHistory({ runs }: { runs: RunView[] }) {
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
        const tieneDetalle = run.missing.length > 0 || run.errors.length > 0;
        const expandida = abierta === run.id;
        return (
          <div
            key={run.id}
            className="rounded-lg border border-foreground/10 bg-background px-4 py-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-foreground/70">
                {run.startedAt} · {run.startedBy}
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
            <p className="mt-1 text-xs text-foreground/60">
              {run.created} creados · {run.updated} actualizados · {run.paused}{" "}
              pausados · {run.failed} fallidos
              {run.usdWarnings > 0 && <> · {run.usdWarnings} USD</>}
              {run.missing.length > 0 && (
                <span className="text-primary-dark">
                  {" "}
                  · {run.missing.length} ausentes
                </span>
              )}
            </p>
            {tieneDetalle && (
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
                {run.missing.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground/70">
                      Activos que el proveedor ya no devuelve:
                    </p>
                    {run.missing.map((m) => (
                      <p key={m.id} className="text-foreground/60">
                        [{m.id}] {m.nombre}
                        {!m.activo && " (ya pausado)"}
                      </p>
                    ))}
                  </div>
                )}
                {run.errors.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground/70">Errores:</p>
                    {run.errors.map((e, i) => (
                      <p key={i} className="break-all text-foreground/60">
                        [{e.externalId}] {e.message.slice(0, 200)}
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

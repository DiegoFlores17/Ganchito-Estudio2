"use client";

import { useState, useTransition } from "react";
import { sendTestSyncAlert } from "@/app/admin/(panel)/proveedores/actions";

/// A quien le llegan las alertas del sync, y un boton para probarlo.
///
/// Si ALERT_EMAIL falta, este bloque es el UNICO lugar donde se ve: sin el,
/// las alertas se pierden en un log que nadie mira.
export function SyncAlertStatus({
  destinatarios,
  invalidos,
  tieneApiKey,
  puedeProbar,
}: {
  destinatarios: string[];
  invalidos: number;
  tieneApiKey: boolean;
  /// El boton manda un mail real: solo super-admin.
  puedeProbar: boolean;
}) {
  const [enviando, startTransition] = useTransition();
  const [resultado, setResultado] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  const configuradas = destinatarios.length > 0 && tieneApiKey;

  function probar() {
    setResultado(null);
    startTransition(async () => {
      try {
        const r = await sendTestSyncAlert();
        setFallo(!r.ok);
        setResultado(
          r.ok
            ? `Enviada${r.id ? ` (id ${r.id})` : ""}. Revisá la bandeja de entrada y la de spam.`
            : `No se envió: ${r.motivo}`
        );
      } catch {
        setFallo(true);
        setResultado("No se pudo enviar la alerta de prueba.");
      }
    });
  }

  return (
    <div className="rounded-xl border border-foreground/10 bg-background p-5 text-sm">
      <p className="font-medium text-foreground">Alertas por mail</p>
      {configuradas ? (
        <p className="mt-1 text-foreground/60">
          Si una sincronización falla o frena el pausado automático, avisa a{" "}
          {destinatarios.join(", ")}.
        </p>
      ) : (
        <p className="mt-1 font-medium text-red-600">
          {!tieneApiKey
            ? "Falta RESEND_API_KEY: las alertas no se envían."
            : "Falta ALERT_EMAIL: las alertas no le llegan a nadie."}
        </p>
      )}
      {invalidos > 0 && (
        <p className="mt-1 text-red-600">
          ALERT_EMAIL tiene {invalidos} entrada(s) que no parecen un email y se
          ignoran.
        </p>
      )}

      {puedeProbar && (
        <div className="mt-3">
          <button
            type="button"
            onClick={probar}
            disabled={enviando || !configuradas}
            className="rounded-full border border-foreground/20 px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50"
          >
            {enviando ? "Enviando..." : "Enviar alerta de prueba"}
          </button>
          {resultado && (
            <p
              className={`mt-2 text-xs ${fallo ? "text-red-600" : "text-foreground/60"}`}
            >
              {resultado}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

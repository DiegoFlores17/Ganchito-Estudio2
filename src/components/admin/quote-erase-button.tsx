"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { borrarDatosPersonales } from "@/app/admin/(panel)/cotizaciones/actions";

/// "Borrar datos personales" del detalle de una cotizacion. Solo se renderiza
/// para super-admin (la pagina decide), y la accion lo vuelve a exigir del
/// lado del servidor.
///
/// La confirmacion es tipear el shortCode, no un "¿seguro?": es irreversible,
/// y un si/no se acepta por reflejo. El servidor compara el codigo igual —
/// habilitar el boton aca es solo comodidad.
export function QuoteEraseButton({
  quoteId,
  shortCode,
}: {
  quoteId: string;
  shortCode: string;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const coincide = codigo.trim().replace(/^#/, "").toUpperCase() === shortCode;

  function handleErase() {
    setError(null);
    startTransition(async () => {
      let resultado: Awaited<ReturnType<typeof borrarDatosPersonales>>;
      try {
        resultado = await borrarDatosPersonales(quoteId, codigo);
      } catch {
        // Ej: se cayo la base despues de borrar el archivo. Reintentar es
        // seguro (borrar un blob que ya no existe no falla), asi que se
        // ofrece eso en vez de la pantalla de error.
        setError("No se pudo completar el borrado. Probá de nuevo.");
        return;
      }
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-primary-dark/20 bg-primary-dark/[0.03] p-5">
      <p className="text-sm font-medium text-foreground">
        Borrar datos personales
      </p>

      {!confirmando ? (
        <>
          <p className="mt-1 text-sm text-foreground/60">
            Para cuando el cliente pide que borremos sus datos. Se conservan
            los productos, los precios y el estado.
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirmando(true);
            }}
            className="mt-4 rounded-lg border border-primary-dark/30 px-4 py-2 text-sm font-medium text-primary-dark transition-colors hover:bg-primary-dark/5"
          >
            Borrar datos personales
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-foreground/60">
            Se borran el nombre, el email, el teléfono, la empresa, las notas
            y el archivo del cliente.{" "}
            <span className="font-medium text-foreground">
              No se puede deshacer.
            </span>
          </p>
          <label className="mt-4 flex flex-col gap-1.5 text-sm">
            <span className="text-foreground/70">
              Para confirmar, escribí el código{" "}
              <strong className="text-foreground">{shortCode}</strong>
            </span>
            <input
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="rounded-lg border border-foreground/15 bg-background px-3 py-2 uppercase outline-none focus:border-primary"
            />
          </label>

          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleErase}
              disabled={!coincide || isPending}
              className="rounded-lg bg-primary-dark px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary disabled:opacity-60"
            >
              {isPending ? "Borrando..." : "Borrar definitivamente"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmando(false);
                setCodigo("");
                setError(null);
              }}
              disabled={isPending}
              className="rounded-lg px-4 py-2 text-sm font-medium text-foreground/60 transition-colors hover:text-foreground disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

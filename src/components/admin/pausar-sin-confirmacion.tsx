"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductOrigin } from "@prisma/client";
import { pausarSinConfirmacion } from "@/app/admin/(panel)/proveedores/actions";

/// Boton "Pausar sin confirmación del proveedor". Dos pasos a proposito:
/// el primer click solo muestra que se va a hacer y pide confirmarlo, porque
/// aca nadie del lado del proveedor confirmo la baja.
export function PausarSinConfirmacion({
  provider,
  nombreProveedor,
  externalIds,
}: {
  provider: ProductOrigin;
  nombreProveedor: string;
  externalIds: string[];
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [pausando, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const n = externalIds.length;

  function pausar() {
    setMensaje(null);
    startTransition(async () => {
      const r = await pausarSinConfirmacion(provider, externalIds);
      if (!r.success) {
        setMensaje(r.error ?? "No se pudo pausar.");
        return;
      }
      setConfirmando(false);
      setMensaje(`${r.pausados} pausados.`);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 text-xs">
      {!confirmando ? (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="rounded-full border border-amber-300 bg-white px-4 py-1.5 font-medium text-amber-800 transition-colors hover:bg-amber-100"
        >
          Pausar sin confirmación del proveedor
        </button>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-white p-3">
          <p className="text-foreground/80">
            {nombreProveedor} no confirmó que {n === 1 ? "este producto esté dado" : `estos ${n} productos estén dados`} de
            baja. Pausá solo si ya {n === 1 ? "lo buscaste" : "los buscaste"} en su web y no {n === 1 ? "está" : "están"}. Si
            vuelve{n === 1 ? "" : "n"} al listado, la sincronización {n === 1 ? "lo" : "los"} reactiva sola.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={pausar}
              disabled={pausando}
              className="rounded-full bg-amber-700 px-4 py-1.5 font-medium text-white transition-colors hover:bg-amber-800 disabled:opacity-60"
            >
              {pausando ? "Pausando..." : `Sí, pausar ${n === 1 ? "el producto" : `los ${n}`} sin confirmación`}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={pausando}
              className="rounded-full px-4 py-1.5 text-foreground/70 hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {mensaje && <p className="mt-2 text-foreground/70">{mensaje}</p>}
    </div>
  );
}

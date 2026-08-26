"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProduct } from "@/app/admin/(panel)/productos/actions";

/// Eliminar un producto manual, con confirmacion en dos pasos.
///
/// Vive en la pantalla de edicion y no en la grilla a proposito: aca el admin
/// ya esta mirando ESE producto y sabe cual es. Un boton de borrar suelto en
/// una fila de tabla se toca por error.
///
/// La confirmacion es inline y no window.confirm: se puede estilar, no bloquea
/// el hilo, y sobre todo puede explicar QUE va a pasar — que no es un borrado
/// real y que las cotizaciones existentes lo van a seguir mostrando.
export function DeleteProductButton({
  productId,
  productName,
  quoteCount,
}: {
  productId: string;
  productName: string;
  quoteCount: number;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteProduct(productId);
      if (!result.success) {
        setError(result.error ?? "No se pudo eliminar.");
        setConfirmando(false);
        return;
      }
      router.push("/admin/productos");
      router.refresh();
    });
  }

  return (
    <div className="mt-12 rounded-xl border border-primary-dark/20 bg-primary-dark/[0.03] p-5">
      <p className="text-sm font-medium text-foreground">Eliminar producto</p>

      {!confirmando ? (
        <>
          <p className="mt-1 text-sm text-foreground/60">
            Lo saca del catálogo y del panel. No se borra de la base: las
            cotizaciones que lo incluyan lo van a seguir mostrando.
          </p>
          <button
            type="button"
            // Se limpia el error del intento anterior: dejarlo puesto mientras
            // se pregunta "¿seguro?" mezcla el resultado de la vez pasada con
            // la pregunta de ahora.
            onClick={() => {
              setError(null);
              setConfirmando(true);
            }}
            className="mt-4 rounded-lg border border-primary-dark/30 px-4 py-2 text-sm font-medium text-primary-dark transition-colors hover:bg-primary-dark/5"
          >
            Eliminar producto
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-foreground">
            ¿Eliminar <span className="font-medium">{productName}</span>?
          </p>
          <p className="mt-1 text-sm text-foreground/60">
            {quoteCount > 0
              ? `Aparece en ${quoteCount} ${
                  quoteCount === 1 ? "cotización" : "cotizaciones"
                }. Se oculta del catálogo, pero ${
                  quoteCount === 1 ? "esa cotización lo va" : "esas cotizaciones lo van"
                } a seguir mostrando.`
              : "Todavía no aparece en ninguna cotización. Se oculta del catálogo y del panel."}
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-lg bg-primary-dark px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary disabled:opacity-60"
            >
              {isPending ? "Eliminando..." : "Sí, eliminar"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={isPending}
              className="rounded-lg px-4 py-2 text-sm font-medium text-foreground/60 transition-colors hover:text-foreground disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-primary-dark/5 px-4 py-2 text-sm text-primary-dark">
          {error}
        </p>
      )}
    </div>
  );
}

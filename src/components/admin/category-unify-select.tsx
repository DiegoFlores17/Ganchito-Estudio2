"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCategoryCanonical } from "@/app/admin/(panel)/categorias/actions";

export interface CanonicalOption {
  id: string;
  name: string;
}

/// Selector de "unificar con" para una categoria de proveedor.
///
/// Es un <select> y no un boton por opcion porque la lista de canonicas
/// crece: con seis categorias propias y 33 de proveedor, una grilla de
/// botones seria ilegible.
export function CategoryUnifySelect({
  categoryId,
  categoryName,
  canonicalId,
  options,
}: {
  categoryId: string;
  categoryName: string;
  canonicalId: string | null;
  options: CanonicalOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      const result = await setCategoryCanonical(categoryId, value || null);
      // El error se muestra por alert y no inline porque este control vive en
      // una celda de tabla: un parrafo de error ahi adentro empuja toda la
      // fila y descoloca la grilla. Los casos que fallan son todos estados
      // invalidos que la propia lista ya evita ofrecer.
      if (!result.success && result.error) window.alert(result.error);
      router.refresh();
    });
  }

  return (
    <span className="flex items-center justify-end gap-2">
      {/* El aviso va AL LADO del select y no adentro: cambiarle el texto a
          las <option> mientras guarda las pisaria todas. */}
      {isPending && (
        <span className="text-xs text-foreground/50">Guardando...</span>
      )}
      <select
        value={canonicalId ?? ""}
        disabled={isPending || options.length === 0}
        onChange={(e) => handleChange(e.target.value)}
        aria-label={`Unificar ${categoryName} con una categoría de la tienda`}
        className="max-w-[200px] rounded-lg border border-foreground/15 bg-background px-2.5 py-1.5 text-xs text-foreground/80 transition-colors hover:border-primary disabled:opacity-60"
      >
        <option value="">
          {options.length === 0 ? "Creá una categoría primero" : "Sin unificar"}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </span>
  );
}

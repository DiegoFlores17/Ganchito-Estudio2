"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleCategoryVisible } from "@/app/admin/(panel)/categorias/actions";

export function ToggleCategoryVisibleButton({
  categoryId,
  categoryName,
  visible,
}: {
  categoryId: string;
  categoryName: string;
  visible: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await toggleCategoryVisible(categoryId, !visible);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handleClick}
      // El nombre va en el label accesible porque el texto visible ("Ocultar")
      // se repite en todas las filas: con lector de pantalla, treinta y nueve
      // botones que dicen lo mismo no distinguen nada.
      aria-label={
        visible ? `Ocultar ${categoryName}` : `Mostrar ${categoryName}`
      }
      className="text-xs font-medium text-foreground/50 transition-colors hover:text-primary disabled:opacity-60"
    >
      {/* Mismo criterio que ToggleActiveButton: cambia el TEXTO, no solo la
          opacidad. En una tabla larga un boton apenas atenuado no se lee como
          "esto esta pasando". */}
      {isPending
        ? visible
          ? "Ocultando..."
          : "Mostrando..."
        : visible
          ? "Ocultar"
          : "Mostrar"}
    </button>
  );
}

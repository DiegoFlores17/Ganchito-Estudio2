"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCategoryMenuGroup } from "@/app/admin/(panel)/categorias/actions";

/// Asigna el grupo del menu de una categoria.
///
/// Es un input con datalist y no un select: el requisito es ofrecer los grupos
/// que ya existen Y permitir escribir uno nuevo sin pasar por un deploy. El
/// datalist nativo hace las dos cosas sin estado propio ni dependencias.
///
/// Lo que el datalist NO garantiza es que el cliente elija de la lista en vez
/// de escribir "hogar y bebidas" a mano. Por eso la normalizacion vive en la
/// server action (ver resolverMenuGroup): si lo escrito coincide con un grupo
/// existente ignorando mayusculas y acentos, se guarda el existente.
///
/// Se guarda al SALIR del campo, no en cada tecla: escribir "Hogar" dispararia
/// cinco guardados y cuatro grupos basura.
export function CategoryMenuGroupInput({
  categoryId,
  categoryName,
  menuGroup,
  gruposExistentes,
}: {
  categoryId: string;
  categoryName: string;
  menuGroup: string | null;
  gruposExistentes: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [valor, setValor] = useState(menuGroup ?? "");
  const [error, setError] = useState<string | null>(null);

  function guardar() {
    // Sin cambios respecto de lo guardado: no se toca la base.
    if (valor.trim() === (menuGroup ?? "").trim()) return;

    startTransition(async () => {
      const r = await setCategoryMenuGroup(categoryId, valor);
      if (!r.success) {
        setError(r.error ?? "No se pudo guardar.");
        setValor(menuGroup ?? "");
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  const listId = `grupos-menu-${categoryId}`;

  return (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        list={listId}
        value={valor}
        disabled={isPending}
        onChange={(e) => setValor(e.target.value)}
        onBlur={guardar}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          // Escape descarta lo escrito y vuelve a lo guardado.
          if (e.key === "Escape") {
            setValor(menuGroup ?? "");
            e.currentTarget.blur();
          }
        }}
        placeholder="Sin grupo"
        // El nombre en el label accesible: el placeholder se repite en todas
        // las filas y con lector de pantalla no distingue una de otra.
        aria-label={`Grupo del menú de ${categoryName}`}
        className="w-40 rounded-md border border-foreground/15 bg-background px-2 py-1 text-xs text-foreground placeholder:text-foreground/35 focus:border-primary focus:outline-none disabled:opacity-60"
      />
      <datalist id={listId}>
        {gruposExistentes.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      {isPending && (
        <span className="text-[11px] text-foreground/50">Guardando...</span>
      )}
      {error && <span className="text-[11px] text-primary-dark">{error}</span>}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unifyIntoNewCategory } from "@/app/admin/(panel)/categorias/actions";

export interface SuggestionMember {
  id: string;
  name: string;
  origin: string;
  productCount: number;
}

/// Una sugerencia de unificacion: categorias que se llaman igual una vez
/// normalizado el nombre.
///
/// **Sugiere, no aplica.** El nombre de la categoria nueva viene precargado
/// pero es editable, y no pasa nada hasta que alguien aprieta el boton. El
/// matcheo por nombre acierta en los casos obvios y falla callado en los que
/// no lo son ("Escritorio" vs "Escritura" se parecen y son cosas distintas;
/// "Hogar" y "Hogar y Tiempo Libre" son lo mismo y no matchean), asi que la
/// decision final siempre es de una persona.
export function CategorySuggestion({
  members,
  defaultName,
}: {
  members: SuggestionMember[];
  defaultName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const total = members.reduce((n, m) => n + m.productCount, 0);

  function handleUnify() {
    setError(null);
    startTransition(async () => {
      const result = await unifyIntoNewCategory(
        name,
        members.map((m) => m.id)
      );
      if (!result.success) {
        setError(result.error ?? "No se pudo unificar.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-foreground/10 bg-background p-4">
      <p className="text-sm text-foreground/70">
        {members.map((m, i) => (
          <span key={m.id}>
            {i > 0 && <span className="text-foreground/40"> · </span>}
            <span className="font-medium text-foreground">{m.name}</span>{" "}
            <span className="text-xs text-foreground/50">
              ({m.origin}, {m.productCount})
            </span>
          </span>
        ))}
      </p>
      <p className="mt-1 text-xs text-foreground/50">
        Se llaman igual. Unificarlas las junta en una sola categoría de{" "}
        {total} productos.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          aria-label="Nombre de la categoría unificada"
          className="w-64 rounded-full border border-foreground/15 bg-background px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={handleUnify}
          disabled={isPending || name.trim().length < 2}
          className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {isPending ? "Unificando..." : "Unificar con este nombre"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOwnCategory } from "@/app/admin/(panel)/categorias/actions";

/// Alta de una categoria PROPIA (de la tienda). Es la unica que se crea a
/// mano: el resto las crean los conectores.
export function NewCategoryForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createOwnCategory(formData);
      if (!result.success) {
        setError(result.error ?? "No se pudo crear la categoría.");
        return;
      }
      // Se limpia el campo: crear varias seguidas es el caso normal al armar
      // el mapeo por primera vez.
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="flex flex-wrap items-start gap-3"
    >
      <div>
        <input
          name="name"
          required
          maxLength={60}
          placeholder="Ej: Lapiceras y escritura"
          className="w-72 rounded-full border border-foreground/15 bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {isPending ? "Creando..." : "Crear categoría"}
      </button>
    </form>
  );
}

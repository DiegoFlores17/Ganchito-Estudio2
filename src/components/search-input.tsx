"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const DEBOUNCE_MS = 350;

export function SearchInput({
  basePath,
  initialValue,
  extraParams,
  placeholder,
}: {
  basePath: string;
  initialValue?: string;
  extraParams?: Record<string, string | undefined>;
  placeholder?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue ?? "");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // El efecto de debounce corre tambien en el montaje. Sin este guard, entrar
  // a cualquier pagina con el buscador dispara un router.replace que el
  // usuario nunca pidio: ademas de encender el indicador de carga de la nada,
  // reescribe la URL sin el parametro "page" y devuelve al cliente a la
  // pagina 1 del catalogo. Solo navegamos cuando el valor cambia de verdad.
  const skipNextRef = useRef(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {
      const params = new URLSearchParams();
      for (const [key, val] of Object.entries(extraParams ?? {})) {
        if (val) params.set(key, val);
      }
      // Nueva busqueda: siempre vuelve a la pagina 1 (no arrastra "page").
      if (value.trim()) params.set("q", value.trim());

      const query = params.toString();
      // El replace va dentro de la transicion para poder mostrar que se esta
      // buscando: isPending queda en true hasta que el server devuelve los
      // resultados nuevos. Sin esto, la grilla vieja se queda en pantalla sin
      // ninguna señal y el usuario cree que no paso nada.
      startTransition(() => {
        router.replace(query ? `${basePath}?${query}` : basePath, {
          scroll: false,
        });
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // Solo re-disparar cuando cambia lo que el usuario tipea: es el patron
    // de debounce, no queremos que basePath/extraParams re-ejecuten esto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative w-full sm:w-72">
      <input
        type="search"
        defaultValue={initialValue}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder ?? "Buscar..."}
        className="w-full rounded-full border border-foreground/15 py-2.5 pl-4 pr-10 text-sm outline-none focus:border-primary"
      />

      {/* El spinner ocupa su lugar siempre (el input reserva pr-10) y solo
          cambia de opacidad: asi aparecer o desaparecer no mueve el layout. */}
      <span
        aria-hidden
        className={
          "pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-primary/25 border-t-primary transition-opacity duration-200 " +
          (isPending ? "animate-spin opacity-100" : "opacity-0")
        }
      />

      <span role="status" aria-live="polite" className="sr-only">
        {isPending ? "Buscando productos…" : ""}
      </span>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
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
  // usuario nunca pidio: la query se reconstruye desde cero con extraParams +
  // q, y como "page" no esta en ninguno de los dos, se pierde. Efecto visible:
  // entrar a /catalogo?page=3 devolvia a la pagina 1 sola, 350ms despues.
  // Solo navegamos cuando el valor tipeado cambia de verdad.
  const skipNextRef = useRef(true);

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
      router.replace(query ? `${basePath}?${query}` : basePath, {
        scroll: false,
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
    <input
      type="search"
      defaultValue={initialValue}
      onChange={(event) => setValue(event.target.value)}
      placeholder={placeholder ?? "Buscar..."}
      className="w-full rounded-full border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary sm:w-72"
    />
  );
}

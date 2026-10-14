"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClearSearchButton, SIN_CRUZ_NATIVA } from "@/components/clear-search-button";

const DEBOUNCE_MS = 350;

/// Buscador que filtra en vivo la pagina donde esta (catalogo, admin de
/// productos): debounce y router.replace, sin apilar historial.
export function SearchInput({
  basePath,
  initialValue,
  placeholder,
}: {
  basePath: string;
  initialValue?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // La busqueda que la URL ya tiene aplicada. El efecto de debounce corre
  // tambien en el montaje (y en desarrollo, DOS veces: Strict Mode monta,
  // desmonta y vuelve a montar). Si navegara ahi, entrar a /catalogo?page=3
  // dispararia un router.replace que nadie pidio y borraria "page" — el bug
  // de la paginacion que se reseteaba sola (ver HANDOFF). Por eso se navega
  // solo cuando el texto difiere de lo YA aplicado, no "despues del primer
  // efecto": un flag de una sola vez se consume en el primer montaje de
  // Strict Mode y deja pasar el segundo.
  const aplicadoRef = useRef((initialValue ?? "").trim());
  // Borrar con la cruz o con Escape aplica YA, sin esperar el debounce: el
  // cliente pidio volver al catalogo sin busqueda, no esta tipeando.
  const inmediatoRef = useRef(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (value.trim() === aplicadoRef.current) {
      // Nada que aplicar (p. ej. se borro antes de que el debounce aplicara
      // lo tipeado): tampoco queda pendiente un borrado inmediato.
      inmediatoRef.current = false;
      return;
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const espera = inmediatoRef.current ? 0 : DEBOUNCE_MS;
    inmediatoRef.current = false;

    timeoutRef.current = setTimeout(() => {
      // Se parte de la URL ACTUAL y solo se tocan "q" y "page": asi la
      // busqueda conserva TODO lo demas (categoria, precio, colores,
      // tecnicas). Antes se reconstruia desde cero con una lista de
      // parametros a preservar, y los multi-valor (colores, tecnicas) no
      // estaban en esa lista: escribir en el buscador los borraba.
      const params = new URLSearchParams(window.location.search);
      // Nueva busqueda: siempre vuelve a la pagina 1 (no arrastra "page").
      params.delete("page");
      if (value.trim()) params.set("q", value.trim());
      else params.delete("q");

      aplicadoRef.current = value.trim();
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
    }, espera);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // Solo re-disparar cuando cambia lo que el usuario tipea: es el patron
    // de debounce, no queremos que basePath re-ejecute esto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function borrar() {
    inmediatoRef.current = true;
    setValue("");
    // El foco vuelve al campo: el que borra suele querer escribir otra cosa.
    inputRef.current?.focus();
  }

  return (
    <div className="relative w-full sm:w-72">
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Escape borra (y vuelve a la grilla sin busqueda). Se maneja aca
          // y no se deja al navegador: Firefox no lo hace, y Chrome borra el
          // texto sin pasar por este flujo inmediato.
          if (event.key === "Escape" && value) {
            event.preventDefault();
            borrar();
          }
        }}
        placeholder={placeholder ?? "Buscar..."}
        className={`w-full rounded-full border border-foreground/15 py-2.5 pl-4 pr-20 text-sm outline-none focus:border-primary sm:pr-16 ${SIN_CRUZ_NATIVA}`}
      />

      {/* El spinner ocupa su lugar siempre y solo cambia de opacidad: asi
          aparecer o desaparecer no mueve el layout. Va a la izquierda de la
          cruz, que tiene su propio lugar a la derecha. */}
      <span
        aria-hidden
        className={
          "pointer-events-none absolute right-12 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-primary/25 border-t-primary transition-opacity duration-200 sm:right-10 " +
          (isPending ? "animate-spin opacity-100" : "opacity-0")
        }
      />

      {value && (
        <ClearSearchButton
          onClick={borrar}
          className="absolute right-1 top-1/2 -translate-y-1/2"
        />
      )}

      <span role="status" aria-live="polite" className="sr-only">
        {isPending ? "Buscando productos…" : ""}
      </span>
    </div>
  );
}

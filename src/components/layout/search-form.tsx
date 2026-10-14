"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type Ref } from "react";
import { ClearSearchButton, SIN_CRUZ_NATIVA } from "@/components/clear-search-button";

/// El formulario de búsqueda de la barra. Lleva al catálogo con la búsqueda
/// ya aplicada.
///
/// **No es el mismo que el de /catalogo, y no debe serlo.** Aquel
/// (`components/search-input.tsx`) es un filtro en vivo: debounce y
/// `router.replace`, para no apilar historial mientras se filtra lo que ya
/// estás mirando. Este es un salto: navega y apila. Por eso el buscador de la
/// barra NO se muestra en /catalogo — ver `SearchIconButton` y
/// `HeaderSearchDesktop`.
export function SearchForm({
  inputRef,
  onSubmitted,
  autoFocus = false,
  className = "",
  inputId,
}: {
  /// Para poder enfocar el campo desde afuera al desplegarlo en mobile.
  inputRef?: Ref<HTMLInputElement>;
  /// Se llama al enviar. Lo usa la fila mobile para cerrarse sola.
  onSubmitted?: () => void;
  autoFocus?: boolean;
  className?: string;
  /// Cada instancia necesita su propio id: el formulario de desktop y el de
  /// la fila mobile conviven en el DOM (uno oculto por CSS), y dos `<label
  /// for>` apuntando al mismo id dejan el segundo sin etiqueta.
  inputId: string;
}) {
  const router = useRouter();
  // El campo se encuentra por el FORMULARIO (no con una ref propia): la ref
  // del input ya es la de afuera (inputRef), que la fila mobile usa para
  // enfocarlo al abrirse.
  const formRef = useRef<HTMLFormElement>(null);
  const [tieneTexto, setTieneTexto] = useState(false);

  /// Borra el campo. Aca no hay busqueda aplicada que deshacer: este
  /// buscador solo navega al enviar, asi que borrar es vaciar el texto.
  function borrar() {
    const campo = formRef.current?.elements.namedItem("q");
    if (campo instanceof HTMLInputElement) {
      campo.value = "";
      campo.focus();
    }
    setTieneTexto(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // El valor se lee del FORMULARIO y no de un estado propio: asi la ruta con
    // JS y la ruta sin JS parten del mismo dato.
    const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    // URLSearchParams y no encodeURIComponent: un form GET nativo codifica los
    // espacios como "+", y URLSearchParams hace lo mismo. Con
    // encodeURIComponent saldria "%20" y las dos rutas generarian URLs
    // distintas para la misma busqueda.
    router.push(q ? `/catalogo?${new URLSearchParams({ q })}` : "/catalogo");
    onSubmitted?.();
  }

  return (
    // action + method son el camino REAL, no un adorno: un form GET nativo a
    // /catalogo con un campo llamado "q" produce exactamente /catalogo?q=…,
    // que es la URL que el catalogo ya sabe leer. Si el JS todavia no hidrato
    // (o falla), el buscador igual funciona; el onSubmit solo lo mejora a
    // navegacion blanda con la entrada de historial correcta.
    <form
      ref={formRef}
      action="/catalogo"
      method="get"
      onSubmit={handleSubmit}
      // Le dice a los lectores de pantalla que esto es EL buscador de la
      // pagina, no un formulario cualquiera.
      role="search"
      className={`relative ${className}`}
    >
      <label htmlFor={inputId} className="sr-only">
        Buscar productos
      </label>
      <input
        ref={inputRef}
        id={inputId}
        // type="search" por la semantica (y el teclado del telefono); su X
        // nativa se oculta y la reemplaza ClearSearchButton, con los colores
        // de la tienda. enterkeyhint es el que cambia la tecla de Enter del
        // teclado del telefono a "Buscar" (inputmode sola no lo hace).
        type="search"
        name="q"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Buscá un producto"
        onInput={(event) => setTieneTexto(event.currentTarget.value !== "")}
        onKeyDown={(event) => {
          // Escape con texto: borra y NO cierra la fila mobile. Un segundo
          // Escape, ya con el campo vacio, si la cierra.
          if (event.key === "Escape" && event.currentTarget.value) {
            // preventDefault es la señal que mira header-controls para no
            // cerrar la fila (ver alTecla ahi).
            event.preventDefault();
            borrar();
          }
        }}
        className={`w-full rounded-full border border-foreground/15 bg-background py-2.5 pl-4 pr-[5.5rem] text-sm text-foreground outline-none placeholder:text-foreground/45 focus:border-primary sm:pr-20 ${SIN_CRUZ_NATIVA}`}
      />
      {tieneTexto && (
        <ClearSearchButton
          onClick={borrar}
          className="absolute right-11 top-1/2 -translate-y-1/2 sm:right-10"
        />
      )}
      <button
        type="submit"
        // El icono solo no dice nada a un lector de pantalla.
        aria-label="Buscar"
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/5 hover:text-primary"
      >
        <SearchIcon />
      </button>
    </form>
  );
}

export function SearchIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

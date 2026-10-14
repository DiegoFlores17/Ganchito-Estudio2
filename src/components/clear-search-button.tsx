/// Boton para borrar el texto de un buscador. Reemplaza al nativo de
/// `input type="search"` (::-webkit-search-cancel-button), que el navegador
/// dibuja con su propio color — azul en Chrome y Safari —, sin hover y sin
/// parecer un boton de la tienda.
///
/// Area tactil de 40px en mobile (lo minimo para un dedo); en desktop baja a
/// 32px para no comerse el campo.
export function ClearSearchButton({
  onClick,
  className = "",
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Borrar búsqueda"
      className={
        "flex h-10 w-10 items-center justify-center rounded-full text-foreground/50 transition-colors hover:bg-primary-light/15 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-8 sm:w-8 " +
        className
      }
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

/// Clases que ocultan la cruz NATIVA de un input type="search" (WebKit y
/// Blink). Se aplican por input y no globales: el buscador de colores del
/// panel de filtros no tiene boton propio y conserva el nativo.
export const SIN_CRUZ_NATIVA =
  "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none";

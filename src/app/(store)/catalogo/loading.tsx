import { Skeleton } from "@/components/skeleton";

/// Cantidad de cards de relleno. La pagina real trae PRODUCTS_PER_PAGE, pero
/// alcanza con llenar el viewport: mas cards serian nodos que el usuario nunca
/// llega a ver antes de que entre el contenido real.
const PLACEHOLDER_CARDS = 12;

/// Fallback de /catalogo mientras corren las tres queries de la pagina
/// (productos + categorias + configuracion de precios).
///
/// El titulo y la bajada NO son skeleton: son texto fijo que no depende de la
/// base, asi que se renderizan de verdad. Solo se dibuja en gris lo que
/// efectivamente esta esperando datos. Las medidas replican las de page.tsx
/// para que al entrar el contenido real no salte el layout.
export default function CatalogoLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto max-w-6xl px-6 py-14 sm:py-16"
    >
      <span className="sr-only">Cargando el catálogo…</span>

      <header className="max-w-2xl">
        <h1 className="text-5xl font-black tracking-tight text-foreground">
          Catálogo
        </h1>
        <p className="mt-3 text-foreground/70">
          Merch corporativo para personalizar con el logo de tu empresa.
        </p>
      </header>

      {/* Buscador */}
      <div className="mt-10">
        <Skeleton className="h-[42px] w-full rounded-full sm:w-72" />
      </div>

      {/* Filtro de categorias: pills en desktop, boton unico en mobile,
          igual que CategoryFilter. */}
      <div className="mt-4">
        <div className="hidden flex-wrap gap-2 md:flex">
          {CATEGORY_PILL_WIDTHS.map((width, index) => (
            <Skeleton
              key={index}
              className={`h-[38px] rounded-full ${width}`}
            />
          ))}
        </div>
        <Skeleton className="h-[42px] w-full rounded-full md:hidden" />
      </div>

      {/* Contador de resultados */}
      <Skeleton className="mt-6 h-4 w-40" />

      {/* Grilla de productos */}
      <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: PLACEHOLDER_CARDS }).map((_, index) => (
          <div key={index} className="flex flex-col gap-4">
            <Skeleton className="aspect-square w-full rounded-xl" />
            <div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
              <Skeleton className="mt-3 h-5 w-28" />
            </div>
          </div>
        ))}
      </div>

      {/* Paginacion */}
      <div className="mt-20 flex items-center justify-center gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-9 rounded-full" />
        ))}
      </div>
    </div>
  );
}

/// Anchos variados para que la fila de categorias no parezca una regla de
/// bloques identicos: los nombres reales tienen largos distintos.
const CATEGORY_PILL_WIDTHS = [
  "w-20",
  "w-28",
  "w-24",
  "w-32",
  "w-20",
  "w-36",
  "w-24",
  "w-28",
];

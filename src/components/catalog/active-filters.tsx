import Link from "next/link";
import type { CatalogFilterOptions } from "@/lib/catalog";
import {
  buildCatalogHref,
  formatearPeso,
  hayAlgunFiltro,
  type CatalogFilters,
} from "@/lib/catalog-params";

/// Los filtros puestos, cada uno con su X, y el "Borrar filtros".
///
/// **Se muestra aunque el panel esté cerrado**, que es el punto: sin esto, un
/// cliente que vuelve al catálogo desde una ficha ve la grilla recortada y
/// ningún indicio de por qué. Y en el estado de cero resultados es lo único
/// que le permite sacar el filtro que sobra sin adivinar cuál fue.
///
/// Server Component: solo son links, no hace falta mandar JS para esto.
export function ActiveFilters({
  filtros,
  opciones,
}: {
  filtros: CatalogFilters;
  opciones: CatalogFilterOptions;
}) {
  if (!hayAlgunFiltro(filtros)) return null;

  const etiquetaDe = (lista: { valor: string; etiqueta: string }[], valor: string) =>
    lista.find((o) => o.valor === valor)?.etiqueta ?? valor;

  const chips: Array<{ clave: string; texto: string; href: string }> = [];

  if (filtros.q) {
    chips.push({
      clave: "q",
      texto: `"${filtros.q}"`,
      href: buildCatalogHref(filtros, { q: null }),
    });
  }

  // El precio es UN chip aunque sean dos campos: es un solo criterio, y con dos
  // chips el cliente puede sacar el techo y quedarse con un piso que no pidió
  // por separado.
  if (filtros.precioMin !== undefined || filtros.precioMax !== undefined) {
    const desde = filtros.precioMin !== undefined ? formatearPeso(filtros.precioMin) : null;
    const hasta = filtros.precioMax !== undefined ? formatearPeso(filtros.precioMax) : null;
    chips.push({
      clave: "precio",
      texto: desde && hasta ? `${desde} a ${hasta}` : desde ? `desde ${desde}` : `hasta ${hasta}`,
      href: buildCatalogHref(filtros, { precioMin: null, precioMax: null }),
    });
  }

  for (const c of filtros.colores) {
    chips.push({
      clave: `color-${c}`,
      texto: etiquetaDe(opciones.colores, c),
      href: buildCatalogHref(filtros, {
        colores: filtros.colores.filter((x) => x !== c),
      }),
    });
  }

  for (const t of filtros.tecnicas) {
    chips.push({
      clave: `tecnica-${t}`,
      texto: etiquetaDe(opciones.tecnicas, t),
      href: buildCatalogHref(filtros, {
        tecnicas: filtros.tecnicas.filter((x) => x !== t),
      }),
    });
  }

  // La CATEGORÍA no entra como chip: ya tiene su propio control marcado en
  // violeta arriba, y un segundo lugar para sacarla sería un control duplicado
  // que dice lo mismo.
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.clave}
          href={chip.href}
          scroll={false}
          // El aria-label dice la ACCIÓN, no el contenido: un lector de
          // pantalla leería "Azul" y no sabría que el link lo quita.
          aria-label={`Quitar filtro ${chip.texto}`}
          className="flex items-center gap-1.5 rounded-full bg-primary/10 py-1.5 pl-3 pr-2 text-sm text-primary transition-colors hover:bg-primary/20"
        >
          <span>{chip.texto}</span>
          <IconoX />
        </Link>
      ))}

      {/* Borra TODO, categoría incluida. La categoría no aparece como chip
          porque ya tiene su control marcado arriba, pero sí se va con este
          botón: dice "borrar filtros" y la categoría es un filtro. Dejarla
          puesta obligaría a un segundo gesto para algo que el cliente cree
          que ya hizo. */}
      <Link
        href={buildCatalogHref(filtros, {
          q: null,
          categoria: null,
          precioMin: null,
          precioMax: null,
          colores: [],
          tecnicas: [],
        })}
        scroll={false}
        className="rounded-full px-2 py-1.5 text-sm font-medium text-foreground/55 underline underline-offset-2 transition-colors hover:text-primary"
      >
        Borrar filtros
      </Link>
    </div>
  );
}

function IconoX() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

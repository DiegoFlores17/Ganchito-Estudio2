"use client";

import { useState } from "react";
import type { CatalogFilterOptions } from "@/lib/catalog";
import { hayFiltrosDeFaceta, type CatalogFilters } from "@/lib/catalog-params";
import { FiltersContent } from "./filters-content";

/// El panel de filtros en DESKTOP.
///
/// **Colapsable en el flujo, no un panel lateral.** La grilla es
/// `lg:grid-cols-4` dentro de `max-w-6xl`: un lateral la bajaría a tres
/// columnas en todas las pantallas, incluso con el panel cerrado. Y a lo ancho
/// hay lugar para los chips de color, que son muchos.
///
/// En mobile no se renderiza: ahí los filtros viven dentro del panel de
/// categorías que ya existe (ver CategoryFilter).
export function FiltersPanel({
  filtros,
  opciones,
}: {
  filtros: CatalogFilters;
  opciones: CatalogFilterOptions;
}) {
  // Arranca abierto si hay algo aplicado: con filtros puestos y el panel
  // cerrado, el cliente ve una grilla recortada y los controles que la
  // recortaron escondidos.
  const [abierto, setAbierto] = useState(() => hayFiltrosDeFaceta(filtros));
  const activos = contarActivos(filtros);

  return (
    <div className="hidden md:block">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls="panel-filtros"
        className="flex items-center gap-2 rounded-full border border-foreground/15 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <IconoFiltros />
        <span>Filtros</span>
        {activos > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-white">
            {activos}
          </span>
        )}
        <Chevron abierto={abierto} />
      </button>

      {abierto && (
        <div
          id="panel-filtros"
          className="mt-4 rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-6"
        >
          <FiltersContent filtros={filtros} opciones={opciones} />
        </div>
      )}
    </div>
  );
}

/// Cuántos filtros de faceta hay puestos. El rango de precio cuenta como UNO
/// aunque tenga dos campos: es un solo criterio y contarlo doble exagera el
/// número que ve el cliente.
export function contarActivos(f: CatalogFilters): number {
  const precio = f.precioMin !== undefined || f.precioMax !== undefined ? 1 : 0;
  return precio + f.colores.length + f.tecnicas.length;
}

function IconoFiltros() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="3" y1="7" x2="21" y2="7" />
      <line x1="3" y1="17" x2="21" y2="17" />
      <circle cx="9" cy="7" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="17" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Chevron({ abierto }: { abierto: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      className={"transition-transform " + (abierto ? "rotate-180" : "")}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

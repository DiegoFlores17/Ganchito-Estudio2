"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageNavLabel, PageNumber } from "@/components/catalog/link-content";

/// Tope para soltar la pagina tocada si la navegacion nunca llega. Sin esto,
/// un numero se quedaria marcado como actual sin serlo — un estado optimista
/// equivocado es peor que no tener ninguno.
const PAGINA_SALIDA_MS = 2000;

function buildHref(page: number, categorySlug?: string, search?: string) {
  const params = new URLSearchParams();
  if (categorySlug) params.set("categoria", categorySlug);
  if (search) params.set("q", search);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/catalogo?${query}` : "/catalogo";
}

/// Ventana de paginas alrededor de la actual, con "..." para los saltos.
/// Con 552 productos (23 paginas) listar todas seria ruido visual.
function buildPageWindow(current: number, total: number): (number | "...")[] {
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const result: (number | "...")[] = [];
  let previous: number | undefined;
  for (const page of sorted) {
    if (previous !== undefined && page - previous > 1) result.push("...");
    result.push(page);
    previous = page;
  }
  return result;
}

export function Pagination({
  currentPage,
  totalPages,
  categorySlug,
  search,
}: {
  currentPage: number;
  totalPages: number;
  categorySlug?: string;
  search?: string;
}) {
  // Que pagina se toco y todavia no llego.
  const [pendingPage, setPendingPage] = useState<number | null>(null);

  // Llego: el server ya mando el currentPage nuevo. Estado derivado, se
  // ajusta en el render.
  if (pendingPage !== null && pendingPage === currentPage) {
    setPendingPage(null);
  }

  // Si la navegacion nunca llega, se suelta la marca: mejor sin indicador que
  // con un numero mintiendo que es la pagina actual.
  useEffect(() => {
    if (pendingPage === null) return;
    const id = setTimeout(() => setPendingPage(null), PAGINA_SALIDA_MS);
    return () => clearTimeout(id);
  }, [pendingPage]);

  if (totalPages <= 1) return null;

  // Mismo criterio que el filtro de categorias: mientras hay navegacion en
  // curso, el numero que manda es el tocado. Si mandara currentPage, el
  // circulo violeta se quedaria en la pagina que el usuario acaba de dejar.
  const paginaMostrada = pendingPage ?? currentPage;

  // La ventana se calcula sobre la pagina REAL, no sobre la optimista: si se
  // recalculara con la tocada, los numeros se reordenarian debajo del dedo
  // antes de que la pagina exista.
  const pageWindow = buildPageWindow(currentPage, totalPages);

  return (
    <nav className="flex items-center justify-center gap-1">
      <PageLink
        href={buildHref(currentPage - 1, categorySlug, search)}
        disabled={currentPage <= 1}
        label="Anterior"
        onNavigate={() => setPendingPage(currentPage - 1)}
      />

      {pageWindow.map((page, index) =>
        page === "..." ? (
          <span
            key={`ellipsis-${index}`}
            className="px-2 text-sm text-foreground/40"
          >
            …
          </span>
        ) : (
          <Link
            key={page}
            href={buildHref(page, categorySlug, search)}
            onClick={() => setPendingPage(page)}
            className="rounded-full"
          >
            <PageNumber page={page} active={page === paginaMostrada} />
          </Link>
        )
      )}

      <PageLink
        href={buildHref(currentPage + 1, categorySlug, search)}
        disabled={currentPage >= totalPages}
        label="Siguiente"
        onNavigate={() => setPendingPage(currentPage + 1)}
      />
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  onNavigate,
}: {
  href: string;
  disabled: boolean;
  label: string;
  onNavigate: () => void;
}) {
  if (disabled) {
    return (
      <span className="px-3 text-sm text-foreground/30" aria-disabled>
        {label}
      </span>
    );
  }

  return (
    <Link href={href} onClick={onNavigate}>
      <PageNavLabel label={label} />
    </Link>
  );
}

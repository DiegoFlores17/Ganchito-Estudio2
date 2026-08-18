import Link from "next/link";
import { PageNavLabel, PageNumber } from "@/components/catalog/link-content";

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
  if (totalPages <= 1) return null;

  const pageWindow = buildPageWindow(currentPage, totalPages);

  return (
    <nav className="flex items-center justify-center gap-1">
      <PageLink
        href={buildHref(currentPage - 1, categorySlug, search)}
        disabled={currentPage <= 1}
        label="Anterior"
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
            className="rounded-full"
          >
            <PageNumber page={page} active={page === currentPage} />
          </Link>
        )
      )}

      <PageLink
        href={buildHref(currentPage + 1, categorySlug, search)}
        disabled={currentPage >= totalPages}
        label="Siguiente"
      />
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="px-3 text-sm text-foreground/30" aria-disabled>
        {label}
      </span>
    );
  }

  return (
    <Link href={href}>
      <PageNavLabel label={label} />
    </Link>
  );
}

import Link from "next/link";
import type { Category } from "@prisma/client";

function buildHref(categorySlug?: string, search?: string) {
  const params = new URLSearchParams();
  if (categorySlug) params.set("categoria", categorySlug);
  if (search) params.set("q", search);
  const query = params.toString();
  return query ? `/catalogo?${query}` : "/catalogo";
}

export function CategoryFilter({
  categories,
  activeSlug,
  search,
}: {
  categories: Category[];
  activeSlug?: string;
  search?: string;
}) {
  return (
    <nav className="flex flex-wrap gap-2 overflow-x-auto">
      <Link
        href={buildHref(undefined, search)}
        className={
          "shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors " +
          (activeSlug
            ? "bg-foreground/5 text-foreground/70 hover:bg-foreground/10"
            : "bg-primary text-white")
        }
      >
        Todas
      </Link>
      {categories.map((category) => {
        const isActive = category.slug === activeSlug;
        return (
          <Link
            key={category.id}
            href={buildHref(category.slug, search)}
            className={
              "shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors " +
              (isActive
                ? "bg-primary text-white"
                : "bg-foreground/5 text-foreground/70 hover:bg-foreground/10")
            }
          >
            {category.name}
          </Link>
        );
      })}
    </nav>
  );
}

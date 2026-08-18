"use client";

import { useState } from "react";
import Link from "next/link";
import type { Category } from "@prisma/client";
import { CategoryChip, PanelRow } from "@/components/catalog/link-content";

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
  const [open, setOpen] = useState(false);
  const activeCategory = categories.find((c) => c.slug === activeSlug);

  return (
    <>
      {/* Desktop: pills envueltas, como siempre. */}
      <nav className="hidden flex-wrap gap-2 md:flex">
        <CategoryLink
          href={buildHref(undefined, search)}
          active={!activeSlug}
          label="Todas"
        />
        {categories.map((category) => (
          <CategoryLink
            key={category.id}
            href={buildHref(category.slug, search)}
            active={category.slug === activeSlug}
            label={category.name}
          />
        ))}
      </nav>

      {/* Mobile: boton compacto que abre un panel, en vez de las 27 pills
          apiladas ocupando toda la pantalla antes de llegar a un producto. */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-full border border-foreground/15 px-4 py-2.5 text-sm font-medium text-foreground/80"
        >
          <FilterIcon />
          {activeCategory ? activeCategory.name : "Filtrar por categoría"}
        </button>

        {open && (
          <div className="fixed inset-0 z-50 flex flex-col bg-background">
            <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
              <p className="text-sm font-medium text-foreground">
                Categorías
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar filtro"
                className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <PanelLink
                href={buildHref(undefined, search)}
                active={!activeSlug}
                label="Todas"
                onNavigate={() => setOpen(false)}
              />
              {categories.map((category) => (
                <PanelLink
                  key={category.id}
                  href={buildHref(category.slug, search)}
                  active={category.slug === activeSlug}
                  label={category.name}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function CategoryLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    // El Link se queda solo con lo estructural: el aspecto vive en el hijo.
    <Link href={href} className="shrink-0 rounded-full">
      <CategoryChip active={active} label={label} />
    </Link>
  );
}

function PanelLink({
  href,
  active,
  label,
  onNavigate,
}: {
  href: string;
  active: boolean;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link href={href} onClick={onNavigate} className="block">
      <PanelRow active={active} label={label} />
    </Link>
  );
}

function FilterIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <circle cx="9" cy="7" r="2.2" fill="var(--background)" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="16" cy="17" r="2.2" fill="var(--background)" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

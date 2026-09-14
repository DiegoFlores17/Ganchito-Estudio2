"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { MenuGroup } from "@/lib/catalog";

/// Mismo tope que el menu desktop, por la misma razon: la fila de sueltas no
/// puede crecer sin control. En mobile pesa mas todavia — la lista es
/// vertical, asi que cuarenta items sueltos empujan el CTA de cotizacion
/// fuera de la pantalla.
const MAX_SUELTAS = 8;

interface NavLink {
  label: string;
  href: string;
}

export function MobileNav({
  navLinks,
  menuGroups,
}: {
  navLinks: NavLink[];
  /// Los mismos grupos que usa el menu desktop: la query la hace el Header y
  /// la comparte. Las categorias viven DENTRO de este panel y no en un
  /// componente aparte — en mobile no hace falta un desplegable sobre otro.
  menuGroups: MenuGroup[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5"
      >
        <HamburgerIcon />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
            <Link href="/" onClick={() => setOpen(false)} className="shrink-0">
              <Image
                src="/logo-ganchito.svg"
                alt="Ganchito Estudio"
                width={191}
                height={38}
              />
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar menú"
              className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5"
            >
              <CloseIcon />
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-2 px-6 py-10">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-3 text-2xl font-medium text-foreground transition-colors hover:text-primary-light"
              >
                {link.label}
              </Link>
            ))}

            {menuGroups.length > 0 && (
              <div className="mt-6 flex flex-col gap-6 border-t border-black/5 pt-6">
                {menuGroups.map((grupo) => (
                  <div key={grupo.name ?? "sin-grupo"}>
                    {/* Las sueltas van sin encabezado: ponerles uno
                        ("Otras") les daria una jerarquia que no tienen. */}
                    {grupo.name && (
                      <p className="mb-2 text-xs font-semibold tracking-wide text-foreground/40">
                        {grupo.name}
                      </p>
                    )}
                    <div className="flex flex-col">
                      {(grupo.name === null
                        ? grupo.categories.slice(0, MAX_SUELTAS)
                        : grupo.categories
                      ).map((c) => (
                        <Link
                          key={c.id}
                          href={`/catalogo?categoria=${c.slug}`}
                          onClick={() => setOpen(false)}
                          className="py-2 text-base text-foreground/80 transition-colors hover:text-primary"
                        >
                          {c.name}
                        </Link>
                      ))}
                      {grupo.name === null &&
                        grupo.categories.length > MAX_SUELTAS && (
                          <Link
                            href="/catalogo"
                            onClick={() => setOpen(false)}
                            className="py-2 text-base text-foreground/50"
                          >
                            y {grupo.categories.length - MAX_SUELTAS} más
                          </Link>
                        )}
                    </div>
                  </div>
                ))}
                <Link
                  href="/catalogo"
                  onClick={() => setOpen(false)}
                  className="text-base font-medium text-primary"
                >
                  Ver todo el catálogo →
                </Link>
              </div>
            )}

            <Link
              href="/cotizar"
              onClick={() => setOpen(false)}
              className="mt-6 rounded-full bg-accent px-6 py-3.5 text-center text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
            >
              Pedí tu cotización
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}

function HamburgerIcon() {
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
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
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

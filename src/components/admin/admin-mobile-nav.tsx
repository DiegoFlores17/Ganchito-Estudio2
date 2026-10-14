"use client";

import { useState } from "react";
import Link from "next/link";

interface AdminNavLink {
  label: string;
  href: string;
  /// Estado que pide atencion (hoy: el catalogo de un proveedor).
  aviso?: "rojo" | "ambar";
  avisoTexto?: string;
}

/// Menú del panel para pantallas chicas.
///
/// Mismo patrón que el `MobileNav` de la tienda (`fixed inset-0`, hamburguesa,
/// cierra al tocar): el panel no necesita un menú propio distinto, y tener dos
/// patrones para lo mismo es lo que hace que uno de los dos se pudra.
///
/// La acción de cerrar sesión llega por props porque es una Server Action y
/// este componente es de cliente.
export function AdminMobileNav({
  navLinks,
  usuario,
  rol,
  signOutAction,
}: {
  navLinks: AdminNavLink[];
  usuario: string;
  rol: string;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  const avisoGeneral = navLinks.find((l) => l.aviso);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={avisoGeneral ? `Abrir menú (${avisoGeneral.avisoTexto})` : "Abrir menú"}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5"
      >
        <HamburgerIcon />
        {/* Con el menu cerrado, el aviso del catalogo tiene que verse igual:
            en el celular el menu esta cerrado casi siempre. */}
        {avisoGeneral && (
          <span
            className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${avisoGeneral.aviso === "rojo" ? "bg-red-600" : "bg-amber-500"}`}
          />
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-foreground/10 px-6 py-4">
            <p className="text-sm font-medium text-primary">
              Ganchito Estudio — Admin
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar menú"
              className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5"
            >
              <CloseIcon />
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-2 px-6 py-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-3 text-2xl font-medium text-foreground transition-colors hover:text-primary"
              >
                <span className="flex items-center gap-2">
                  {link.label}
                  {link.aviso && (
                    <span
                      role="img"
                      aria-label={link.avisoTexto}
                      className={`h-2.5 w-2.5 rounded-full ${link.aviso === "rojo" ? "bg-red-600" : "bg-amber-500"}`}
                    />
                  )}
                </span>
              </Link>
            ))}
          </nav>

          {/* Quién sos y cerrar sesión, al pie: en el header de mobile no
              entran, y son lo que menos se toca. */}
          <div className="border-t border-foreground/10 px-6 py-5">
            <p className="text-xs text-foreground/50">
              {usuario} · {rol}
            </p>
            <form action={signOutAction} className="mt-3">
              <button
                type="submit"
                className="text-sm font-medium text-foreground/70 transition-colors hover:text-primary"
              >
                Cerrar sesión
              </button>
            </form>
          </div>
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

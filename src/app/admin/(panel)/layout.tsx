import type { ReactNode } from "react";
import Link from "next/link";
import { AdminRole } from "@prisma/client";
import { signOut } from "@/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";

export default async function AdminPanelLayout({
  children,
}: {
  children: ReactNode;
}) {
  const admin = await requireAdmin();
  const isSuperAdmin = admin.role === AdminRole.SUPER_ADMIN;

  // Una sola lista para los dos menús: si el de escritorio y el de mobile
  // arman sus links por separado, tarde o temprano uno queda con una pantalla
  // de menos.
  //
  // Categorías es visible para cualquier admin, no solo super admin: ocultar
  // una categoría del filtro no toca precios ni productos, y es reversible de
  // un click.
  const navLinks = [
    { label: "Cotizaciones", href: "/admin/cotizaciones" },
    { label: "Productos", href: "/admin/productos" },
    { label: "Categorías", href: "/admin/categorias" },
    // Sincronizar es operacion del dia a dia (aplica la verdad del
    // proveedor, reversible), no configuracion de negocio: cualquier admin.
    { label: "Proveedores", href: "/admin/proveedores" },
    ...(isSuperAdmin
      ? [
          { label: "Equipo", href: "/admin/equipo" },
          { label: "Configuración", href: "/admin/configuracion" },
        ]
      : []),
  ];

  async function cerrarSesion() {
    "use server";
    await signOut({ redirectTo: "/admin/login" });
  }

  return (
    <div className="flex min-h-screen flex-col bg-foreground/[0.02]">
      <header className="border-b border-foreground/10 bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-8">
            <p className="text-sm font-medium text-primary">
              Ganchito Estudio — Admin
            </p>
            {/* La nav completa entra recién de md: para arriba. Debajo son
                cinco links más el email más "Cerrar sesión" en una sola fila,
                que en un celular se desbordan. */}
            <nav className="hidden items-center gap-6 md:flex">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-foreground/70 transition-colors hover:text-primary"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="hidden items-center gap-4 md:flex">
            <span className="text-xs text-foreground/50">
              {admin.name ?? admin.email} · {isSuperAdmin ? "Super admin" : "Admin"}
            </span>
            <form action={cerrarSesion}>
              <button
                type="submit"
                className="text-xs font-medium text-foreground/50 transition-colors hover:text-primary"
              >
                Cerrar sesión
              </button>
            </form>
          </div>

          <AdminMobileNav
            navLinks={navLinks}
            usuario={admin.name ?? admin.email}
            rol={isSuperAdmin ? "Super admin" : "Admin"}
            signOutAction={cerrarSesion}
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}

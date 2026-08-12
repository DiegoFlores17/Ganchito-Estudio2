import type { ReactNode } from "react";
import Link from "next/link";
import { AdminRole } from "@prisma/client";
import { signOut } from "@/auth";
import { requireAdmin } from "@/lib/admin-auth";

export default async function AdminPanelLayout({
  children,
}: {
  children: ReactNode;
}) {
  const admin = await requireAdmin();
  const isSuperAdmin = admin.role === AdminRole.SUPER_ADMIN;

  return (
    <div className="flex min-h-screen flex-col bg-foreground/[0.02]">
      <header className="border-b border-foreground/10 bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-8">
            <p className="text-sm font-medium text-primary">
              Ganchito Estudio — Admin
            </p>
            <nav className="flex items-center gap-6">
              <Link
                href="/admin/cotizaciones"
                className="text-sm text-foreground/70 transition-colors hover:text-primary"
              >
                Cotizaciones
              </Link>
              <Link
                href="/admin/productos"
                className="text-sm text-foreground/70 transition-colors hover:text-primary"
              >
                Productos
              </Link>
              {isSuperAdmin && (
                <>
                  <Link
                    href="/admin/equipo"
                    className="text-sm text-foreground/70 transition-colors hover:text-primary"
                  >
                    Equipo
                  </Link>
                  <Link
                    href="/admin/configuracion"
                    className="text-sm text-foreground/70 transition-colors hover:text-primary"
                  >
                    Configuracion
                  </Link>
                </>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-xs text-foreground/50">
              {admin.name ?? admin.email} · {isSuperAdmin ? "Super admin" : "Admin"}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/admin/login" });
              }}
            >
              <button
                type="submit"
                className="text-xs font-medium text-foreground/50 transition-colors hover:text-primary"
              >
                Cerrar sesion
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {children}
      </main>
    </div>
  );
}

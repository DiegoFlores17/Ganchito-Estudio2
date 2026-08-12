import { redirect } from "next/navigation";
import { AdminRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export interface CurrentAdmin {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
}

/// Verifica sesion de Google + pertenencia a AdminUser CONTRA LA BASE en
/// cada llamada (no confia en el JWT mas alla del email). Asi, sacar a
/// alguien de AdminUser le corta el acceso en la proxima carga de pagina,
/// no cuando le expire la cookie de sesion.
export async function requireAdmin(): Promise<CurrentAdmin> {
  const session = await auth();
  const email = session?.user?.email;

  if (!email) {
    redirect("/admin/login");
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    return existing;
  }

  const bootstrapped = await tryBootstrapSuperAdmin(email, session?.user?.name);
  if (bootstrapped) {
    return bootstrapped;
  }

  // No se puede hacer signOut() aca: esto corre durante el render de un
  // Server Component (el layout), y las cookies solo se pueden modificar
  // en un Server Action o Route Handler. El cierre de sesion real queda
  // en la pantalla /admin/sin-acceso, que SI es un lugar valido para eso.
  redirect("/admin/sin-acceso");
}

export async function requireSuperAdmin(): Promise<CurrentAdmin> {
  const admin = await requireAdmin();
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    redirect("/admin");
  }
  return admin;
}

/// Bootstrap del primer super-admin: SOLO si AdminUser esta completamente
/// vacia y el email coincide con INITIAL_SUPER_ADMIN_EMAIL. En cuanto
/// existe un registro, este camino se cierra solo (no queda una puerta
/// trasera permanente colgando del env var).
async function tryBootstrapSuperAdmin(
  email: string,
  name: string | null | undefined
): Promise<CurrentAdmin | null> {
  const initialEmail = process.env.INITIAL_SUPER_ADMIN_EMAIL;
  if (!initialEmail || email !== initialEmail) return null;

  const count = await prisma.adminUser.count();
  if (count > 0) return null;

  return prisma.adminUser.create({
    data: { email, name: name ?? null, role: AdminRole.SUPER_ADMIN },
  });
}

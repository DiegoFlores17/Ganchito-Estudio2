"use server";

import { revalidatePath } from "next/cache";
import { AdminRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/admin-auth";

export interface AdminActionResult {
  success: boolean;
  error?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function addAdmin(formData: FormData): Promise<AdminActionResult> {
  await requireSuperAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const roleRaw = String(formData.get("role") ?? "");
  const role = roleRaw === AdminRole.SUPER_ADMIN ? AdminRole.SUPER_ADMIN : AdminRole.ADMIN;

  if (!EMAIL_REGEX.test(email)) {
    return { success: false, error: "El email no es válido." };
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    return { success: false, error: "Ese email ya tiene acceso al panel." };
  }

  await prisma.adminUser.create({ data: { email, name, role } });
  revalidatePath("/admin/equipo");
  return { success: true };
}

export async function removeAdmin(adminId: string): Promise<AdminActionResult> {
  await requireSuperAdmin();

  const target = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!target) {
    return { success: false, error: "Ese admin ya no existe." };
  }

  if (target.role === AdminRole.SUPER_ADMIN) {
    const superAdminCount = await prisma.adminUser.count({
      where: { role: AdminRole.SUPER_ADMIN },
    });
    if (superAdminCount <= 1) {
      return {
        success: false,
        error: "No se puede sacar al ultimo super-admin.",
      };
    }
  }

  await prisma.adminUser.delete({ where: { id: adminId } });
  revalidatePath("/admin/equipo");
  return { success: true };
}

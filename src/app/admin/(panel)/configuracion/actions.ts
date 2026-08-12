"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { getPricingConfig } from "@/lib/pricing";

export interface PricingActionResult {
  success: boolean;
  error?: string;
}

/// vatRate se guarda como fraccion (0.21) pero se edita como porcentaje
/// (21) en el formulario, mas natural para tipear.
export async function updatePricingConfig(
  formData: FormData
): Promise<PricingActionResult> {
  await requireSuperAdmin();

  const marginPercent = Number(formData.get("defaultMarginPercent"));
  const vatPercent = Number(formData.get("vatPercent"));

  if (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent > 1000) {
    return { success: false, error: "El margen tiene que ser un numero entre 0 y 1000." };
  }
  if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100) {
    return { success: false, error: "El IVA tiene que ser un numero entre 0 y 100." };
  }

  await getPricingConfig(); // garantiza que exista la fila (id=1)
  await prisma.pricingConfig.update({
    where: { id: 1 },
    data: {
      defaultMarginPercent: marginPercent,
      vatRate: vatPercent / 100,
    },
  });

  revalidatePath("/admin/configuracion");
  revalidatePath("/catalogo");
  return { success: true };
}

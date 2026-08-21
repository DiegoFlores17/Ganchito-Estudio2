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
  const usdRate = Number(formData.get("usdRate"));

  if (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent > 1000) {
    return { success: false, error: "El margen tiene que ser un número entre 0 y 1000." };
  }
  if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100) {
    return { success: false, error: "El IVA tiene que ser un número entre 0 y 100." };
  }
  // El piso es > 0 y no >= 0: una cotización en cero pondría en cero el precio
  // de TODO lo que venga en dólares, sin que nada falle.
  if (!Number.isFinite(usdRate) || usdRate <= 0) {
    return {
      success: false,
      error: "La cotización del dólar tiene que ser un número mayor a 0.",
    };
  }

  await getPricingConfig(); // garantiza que exista la fila (id=1)
  await prisma.pricingConfig.update({
    where: { id: 1 },
    data: {
      defaultMarginPercent: marginPercent,
      vatRate: vatPercent / 100,
      usdRate,
    },
  });

  revalidatePath("/admin/configuracion");
  revalidatePath("/catalogo");
  // El margen cambia el precio de TODO el catalogo, incluidos los destacados
  // de la home. Sin esta linea la portada seguia mostrando los precios viejos
  // mientras el catalogo ya tenia los nuevos: dos precios distintos para el
  // mismo producto al mismo tiempo. La cotizacion del dolar hace lo mismo con
  // los productos que vienen en USD.
  revalidatePath("/");
  return { success: true };
}

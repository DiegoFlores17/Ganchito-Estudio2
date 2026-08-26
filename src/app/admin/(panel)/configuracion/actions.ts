"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { UsdRateMode } from "@prisma/client";
import { getPricingConfig } from "@/lib/pricing";
import { refreshUsdRate, FUENTE_MANUAL } from "@/lib/usd-rate";
import {
  normalizeInstagramHandle,
  validateWhatsappNumber,
} from "@/lib/site-config";

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

  const modo =
    formData.get("usdRateMode") === "AUTO" ? UsdRateMode.AUTO : UsdRateMode.MANUAL;

  const previa = await getPricingConfig(); // garantiza que exista la fila (id=1)
  const cambioLaCotizacion = Number(previa.usdRate) !== usdRate;

  await prisma.pricingConfig.update({
    where: { id: 1 },
    data: {
      defaultMarginPercent: marginPercent,
      vatRate: vatPercent / 100,
      usdRate,
      usdRateMode: modo,
      // El origen y la fecha solo se tocan si el numero cambio de verdad:
      // guardar el formulario para editar el margen no tiene por que decir
      // que la cotizacion se cargo a mano hoy.
      ...(cambioLaCotizacion
        ? { usdRateSource: FUENTE_MANUAL, usdRateUpdatedAt: new Date() }
        : {}),
    },
  });

  // Pasar a AUTO tiene que APLICAR el oficial, no esperar seis horas. Si la
  // API falla, refreshUsdRate no escribe nada y queda el valor que se acaba
  // de guardar — nunca cero.
  if (modo === UsdRateMode.AUTO) {
    await refreshUsdRate();
  }

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

export interface SiteConfigActionResult {
  success: boolean;
  error?: string;
}

/// Guarda los datos de contacto que se muestran en la tienda.
///
/// Super admin igual que los precios: son datos de cara al publico, y un
/// telefono equivocado en el footer es tan visible como un margen mal puesto.
export async function updateSiteConfig(
  formData: FormData
): Promise<SiteConfigActionResult> {
  await requireSuperAdmin();

  const texto = (campo: string) => String(formData.get(campo) ?? "").trim();

  const contactEmail = texto("contactEmail");
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { success: false, error: "Ese email no parece válido." };
  }

  // El numero se guarda normalizado a digitos; la validacion explica el error
  // concreto (falta el codigo de pais, sobra el 0, sobra el 15).
  const whatsapp = validateWhatsappNumber(texto("whatsappNumber"));
  if (!whatsapp.ok) {
    return { success: false, error: whatsapp.error };
  }

  const instagramRaw = texto("instagramHandle");
  const instagramHandle = instagramRaw
    ? normalizeInstagramHandle(instagramRaw)
    : "";
  if (instagramRaw && !instagramHandle) {
    return {
      success: false,
      error: "No pude leer el usuario de Instagram. Poné @usuario o el link del perfil.",
    };
  }
  if (instagramHandle && !/^[A-Za-z0-9._]{1,30}$/.test(instagramHandle)) {
    return {
      success: false,
      error: `"${instagramHandle}" no parece un usuario de Instagram válido.`,
    };
  }

  // upsert y no update: getSiteConfig() ya NO crea la fila (crear desde el
  // render del Footer volteo un build entero, ver el comentario ahi). La fila
  // nace aca, que es donde se espera escribir, y el upsert es atomico asi que
  // dos guardados simultaneos no se pisan.
  const datos = {
    // Vacio se guarda como null y no como "": asi el footer lo saltea con el
    // mismo chequeo para todos los campos.
    contactEmail: contactEmail || null,
    whatsappNumber: whatsapp.value ?? null,
    instagramHandle: instagramHandle || null,
    address: texto("address") || null,
    openingHours: texto("openingHours") || null,
  };

  await prisma.siteConfig.upsert({
    where: { id: 1 },
    update: datos,
    create: { id: 1, ...datos },
  });

  revalidatePath("/admin/configuracion");
  // El footer vive en el layout de la tienda, asi que estos datos salen en
  // TODAS las paginas publicas. layout: true revalida el arbol entero en vez
  // de una ruta suelta.
  revalidatePath("/", "layout");
  return { success: true };
}

/// Consulta la cotización ahora mismo, desde el botón del panel.
///
/// Es la MISMA función que llama el cron, así que lo que se ve acá es
/// exactamente lo que va a pasar automáticamente.
export async function refreshUsdRateNow() {
  await requireSuperAdmin();
  const resultado = await refreshUsdRate();
  revalidatePath("/admin/configuracion");
  // Si se aplico, cambia el precio de todo lo que cotiza en dolares.
  if (resultado.status === "aplicado") {
    revalidatePath("/catalogo");
    revalidatePath("/");
  }
  return resultado;
}

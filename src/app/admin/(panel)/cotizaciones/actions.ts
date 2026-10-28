"use server";

import { revalidatePath } from "next/cache";
import { QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSuperAdmin } from "@/lib/admin-auth";
import {
  anonimizarCotizacion,
  type ResultadoBorrado,
} from "@/lib/borrado-datos";

export async function updateQuoteStatus(quoteId: string, status: QuoteStatus) {
  // Cualquier admin autenticado puede operar cotizaciones (no es funcion
  // exclusiva de super-admin). requireAdmin() ya valida sesion + membresia.
  await requireAdmin();

  await prisma.quote.update({
    where: { id: quoteId },
    data: { status },
  });

  revalidatePath(`/admin/cotizaciones/${quoteId}`);
  revalidatePath("/admin/cotizaciones");
}

/// Borrado de datos personales a pedido del cliente. Solo super-admin: es
/// irreversible. La logica (y un segundo chequeo del rol contra la base)
/// vive en src/lib/borrado-datos.ts.
export async function borrarDatosPersonales(
  quoteId: string,
  confirmacion: string
): Promise<ResultadoBorrado> {
  const admin = await requireSuperAdmin();

  const resultado = await anonimizarCotizacion({
    quoteId,
    confirmacion,
    actorEmail: admin.email,
  });

  if (resultado.ok) {
    revalidatePath(`/admin/cotizaciones/${quoteId}`);
    revalidatePath("/admin/cotizaciones");
  }
  return resultado;
}

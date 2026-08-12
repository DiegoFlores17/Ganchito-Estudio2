"use server";

import { revalidatePath } from "next/cache";
import { QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";

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

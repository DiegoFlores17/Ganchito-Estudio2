import { prisma } from "@/lib/prisma";
import type { QuoteStatus } from "@prisma/client";

export async function getQuotes({
  search,
  status,
}: {
  /// Email del cliente O shortCode ("#A7F3C2" o "A7F3C2"). Un solo campo de
  /// busqueda para los dos: el vendedor pega lo que tenga a mano — el email
  /// del mail, o el codigo que el cliente menciono por WhatsApp/telefono.
  search?: string;
  status?: QuoteStatus;
} = {}) {
  // El "#" con el que se muestra el codigo no es parte del dato.
  const term = search?.trim().replace(/^#/, "");
  return prisma.quote.findMany({
    where: {
      ...(term
        ? {
            OR: [
              { customerEmail: { equals: term, mode: "insensitive" } },
              { shortCode: { equals: term, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      items: { select: { id: true } },
    },
  });
}

export async function getQuoteById(id: string) {
  return prisma.quote.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });
}

/// Otras cotizaciones del mismo email (historial del cliente), sin contar
/// la actual. Los clientes no tienen cuenta: el email es lo unico que los
/// identifica de una cotizacion a otra.
export async function getQuoteHistoryByEmail(email: string, excludeId: string) {
  return prisma.quote.findMany({
    where: { customerEmail: { equals: email, mode: "insensitive" }, id: { not: excludeId } },
    orderBy: { createdAt: "desc" },
    include: {
      items: { select: { id: true } },
    },
  });
}

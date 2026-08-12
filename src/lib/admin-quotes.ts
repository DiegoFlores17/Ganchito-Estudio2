import { prisma } from "@/lib/prisma";
import type { QuoteStatus } from "@prisma/client";

export async function getQuotes({
  email,
  status,
}: {
  email?: string;
  status?: QuoteStatus;
} = {}) {
  return prisma.quote.findMany({
    where: {
      ...(email ? { customerEmail: { equals: email, mode: "insensitive" } } : {}),
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

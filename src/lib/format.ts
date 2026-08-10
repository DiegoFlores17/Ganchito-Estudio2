// Sin dependencias RUNTIME de Prisma a proposito: este modulo se importa
// tambien desde Client Components (ej. /cotizar). Si formatPriceArs viviera
// en pricing.ts, importarlo del lado del cliente arrastraria el cliente de
// Prisma entero al bundle del navegador. El type import de abajo se borra
// en compilacion (no genera un import real), asi que es seguro.
import type { Prisma } from "@prisma/client";

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function formatPriceArs(value: Prisma.Decimal | number): string {
  return currencyFormatter.format(Number(value));
}

import { Prisma, type PricingConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/// PricingConfig es una fila unica (id siempre 1). Si todavia no existe
/// (proyecto recien clonado, nadie la edito nunca desde el admin), se crea
/// con los defaults del schema la primera vez que se necesita.
export async function getPricingConfig(): Promise<PricingConfig> {
  const existing = await prisma.pricingConfig.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.pricingConfig.create({ data: { id: 1 } });
}

/// Precio de venta SIN IVA: costo * (1 + margen/100). El IVA se muestra
/// aparte siempre (ver DISENO.md), nunca se suma aca.
export function computeSellPrice(
  costPrice: Prisma.Decimal,
  defaultMarginPercent: Prisma.Decimal
): Prisma.Decimal {
  const marginMultiplier = defaultMarginPercent.dividedBy(100).plus(1);
  return costPrice.times(marginMultiplier);
}

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function formatPriceArs(value: Prisma.Decimal | number): string {
  return currencyFormatter.format(Number(value));
}

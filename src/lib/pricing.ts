import { Currency, Prisma, type PricingConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/// PricingConfig es una fila unica (id siempre 1). Si todavia no existe
/// (proyecto recien clonado, nadie la edito nunca desde el admin), se crea
/// con los defaults del schema la primera vez que se necesita.
export async function getPricingConfig(): Promise<PricingConfig> {
  const existing = await prisma.pricingConfig.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.pricingConfig.create({ data: { id: 1 } });
}

/// Lo unico que necesita el calculo de precio. Se acepta el objeto entero de
/// PricingConfig, pero tipado asi para poder pasar tambien un literal en los
/// tests o en un script.
export type PricingInputs = Pick<
  PricingConfig,
  "defaultMarginPercent" | "usdRate"
>;

/// Pasa un costo a pesos si viene en dolares.
///
/// La conversion se hace ACA, al leer, y no al sincronizar: asi mover usdRate
/// en el panel actualiza todo el catalogo al instante, sin re-sincronizar los
/// ~950 productos. Mismo criterio que el margen.
///
/// Zecat siempre queda en ARS: su sync fuerza Currency.ARS al escribir porque
/// el campo currency de su API no es confiable (ver CLAUDE.md). Asi que en la
/// practica esta rama solo aplica a CDO.
function toArs(costPrice: Prisma.Decimal, currency: Currency, usdRate: Prisma.Decimal) {
  return currency === Currency.USD ? costPrice.times(usdRate) : costPrice;
}

/// Precio de venta SIN IVA: costo (en pesos) * (1 + margen/100). El IVA se
/// muestra aparte siempre (ver DISENO.md), nunca se suma aca.
export function computeSellPrice(
  costPrice: Prisma.Decimal,
  currency: Currency,
  { defaultMarginPercent, usdRate }: PricingInputs
): Prisma.Decimal {
  const marginMultiplier = defaultMarginPercent.dividedBy(100).plus(1);
  return toArs(costPrice, currency, usdRate).times(marginMultiplier);
}

export interface PriceRange {
  min: Prisma.Decimal;
  max: Prisma.Decimal;
  /// true cuando las variantes NO cuestan todas lo mismo. Es lo que decide si
  /// la card muestra un precio exacto o un "Desde".
  varies: boolean;
}

/// Rango de precios de venta de un producto, mirando todas sus variantes.
///
/// Existe porque el costo vive en la variante y un producto puede tener
/// variantes a distinto precio (en CDO, el OCEAN tiene 194.97 y 205.23). Una
/// card muestra un solo numero, asi que necesita saber si ese numero es EL
/// precio o apenas el piso.
///
/// Mostrar el minimo como "Desde $X" es honesto; guardarlo como si fuera el
/// precio del producto seria mentir. Por eso esto se calcula al leer y no se
/// persiste en ningun lado.
///
/// Devuelve null si el producto no tiene variantes: quien llama decide que
/// hacer (hoy no deberia pasar, el alta siempre crea al menos una).
export function computePriceRange(
  variants: Array<{ costPrice: Prisma.Decimal }>,
  currency: Currency,
  config: PricingInputs
): PriceRange | null {
  if (variants.length === 0) return null;

  const precios = variants.map((v) =>
    computeSellPrice(v.costPrice, currency, config)
  );

  let min = precios[0];
  let max = precios[0];
  for (const p of precios) {
    if (p.lessThan(min)) min = p;
    if (p.greaterThan(max)) max = p;
  }

  return { min, max, varies: !min.equals(max) };
}

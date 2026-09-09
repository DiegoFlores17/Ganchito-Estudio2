import { Currency, Prisma, type PricingConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RANGE_DISCOUNT_MIN_QUANTITY } from "@/lib/zecat/normalize";

/// PricingConfig es una fila unica (id siempre 1). Si todavia no existe
/// (proyecto recien clonado, nadie la edito nunca desde el admin), se crea
/// con los defaults del schema la primera vez que se necesita.
/// Config de precios. Singleton (id = 1); si no existe, se crea con los
/// defaults del schema.
///
/// Aca SI se crea al leer, a diferencia de getSiteConfig(): los defaults de
/// margen, IVA y dolar viven en el schema, y devolver un objeto "vacio"
/// obligaria a duplicarlos en codigo, donde se desincronizarian.
///
/// El create va con try/catch por la carrera: si dos renders concurrentes
/// encuentran la tabla vacia, los dos intentan crear la fila y uno falla con
/// P2002. Eso volteo un build entero cuando paso en SiteConfig — aca todavia
/// no se disparo solo porque la fila ya existe en las dos bases, pero una
/// base nueva lo dispararia igual.
export async function getPricingConfig(): Promise<PricingConfig> {
  const existing = await prisma.pricingConfig.findUnique({ where: { id: 1 } });
  if (existing) return existing;

  try {
    return await prisma.pricingConfig.create({ data: { id: 1 } });
  } catch {
    // Otro render la creo primero: la fila ya esta, solo hay que leerla.
    return prisma.pricingConfig.findUniqueOrThrow({ where: { id: 1 } });
  }
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

/// Lo que hace falta de una variante para aplicarle su descuento de rango.
export interface VariantDiscountInputs {
  costPrice: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
}

/// Costo de una variante DESPUES del descuento de rango del proveedor.
///
/// `productQuantity` es la cantidad TOTAL del producto en la cotización,
/// sumando todas sus variantes — NO la cantidad de esta variante. Verificado
/// en el backoffice de Zecat: un pedido de 50 talle S + 50 talle M cae en el
/// tramo de 100 unidades, no en el de 2. Por eso el parametro es explicito y
/// se llama asi: pasarle la cantidad de la linea daria un tramo mas caro que
/// el que Zecat efectivamente cobra, y el error seria invisible.
///
/// Que el tramo se elija por el total del producto NO significa que todas las
/// variantes descuenten lo mismo: cada una aplica SU porcentaje. En una Remera
/// Regent con Blanco S y Blanco 3XL, comparten el total que define el tramo
/// pero una descuenta 37,83% y la otra 14,82%.
///
/// Con `productQuantity` 1 se devuelve el costo pelado, porque la escala de
/// Zecat arranca en 2 unidades. No es un detalle: desde que el minimo de
/// compra salio del campo correcto, 624 de 641 productos se pueden pedir desde
/// 1 unidad, y aplicar ahi el descuento de 2+ seria cotizar por debajo del
/// costo real (en una Regent Blanca S, $6.974 de venta contra un costo de
/// $7.736).
///
/// Hoy se usa un solo tramo, el de 2 unidades, que es el que quedo guardado en
/// `discountPercent`. La escala completa esta en `discountTiers`: cuando se
/// quiera usar, se cambia ACA — la firma ya recibe la cantidad correcta y no
/// hace falta re-importar ni migrar.
export function computeVariantCost(
  variant: VariantDiscountInputs,
  productQuantity: number
): Prisma.Decimal {
  if (
    variant.discountPercent === null ||
    productQuantity < RANGE_DISCOUNT_MIN_QUANTITY
  ) {
    return variant.costPrice;
  }
  const factor = new Prisma.Decimal(1).minus(
    variant.discountPercent.dividedBy(100)
  );
  // Guarda: un porcentaje fuera de (0, 100) daria un costo negativo o mayor al
  // original. El conector ya no deberia guardar eso, pero el dato viene del
  // proveedor y esto se lee en cada cotizacion.
  if (factor.lessThanOrEqualTo(0) || factor.greaterThan(1)) {
    return variant.costPrice;
  }
  // Redondeo hacia ARRIBA al centavo, y no al mas cercano, por el principio de
  // no cotizar nunca por debajo del costo.
  //
  // `costPrice` es Decimal(12,2), asi que el costo de primera capa ya viene
  // redondeado: en la Regent Blanca S, Zecat calcula 12893.99 x 0,60 x 0,6217
  // = 4809.72, pero nosotros partimos de 7736.39 (el verdadero es 7736.394) y
  // llegamos a 4809.7137. Redondear al mas cercano daria 4809.71: un centavo
  // POR DEBAJO del costo real. Hacia arriba da 4809.72 y coincide con Zecat.
  //
  // El sesgo maximo es de un centavo por unidad, siempre a nuestro favor.
  return variant.costPrice.times(factor).toDecimalPlaces(2, Prisma.Decimal.ROUND_UP);
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
///
/// NO aplica el descuento de rango, a proposito: una card no tiene cantidad, y
/// el descuento arranca en 2 unidades. Muestra entonces el precio de 1 unidad,
/// que es el mas alto de la escala — honesto y conservador, el mismo criterio
/// por el que "Desde $X" muestra el piso y no el precio que a uno le gustaria.
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

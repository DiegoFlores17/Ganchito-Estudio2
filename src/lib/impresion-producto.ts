import { type Currency, Prisma } from "@prisma/client";
import { aCentavos, formatPriceArsCentavos } from "@/lib/format";
import {
  computePrintingPrice,
  computeSellPriceForQuantity,
  parseDiscountTiers,
  type PricingInputs,
  type VariantDiscountInputs,
} from "@/lib/pricing";
import {
  opcionesDeImpresion,
  opcionPorDefecto,
  resolverSeleccion,
  tituloArea,
} from "@/lib/quote-printing";

// Lectura de la personalizacion de un producto desde la base: lo comparten
// /cotizar (cotizar/actions.ts) y la ficha (tanda 4c), para que las dos
// pantallas ofrezcan EXACTAMENTE las mismas opciones con los mismos precios.
// Solo servidor: maneja costos.

/// Lo que se lee de la base para ofrecer y cotizar la personalizacion. Los
/// costos se quedan en el servidor: al navegador viaja `OpcionImpresion`.
export const SELECT_IMPRESION = {
  printingLevels: {
    select: {
      zecatTypeId: true,
      technique: true,
      label: true,
      areaCm2: true,
      zecatAreaIds: true,
      unitCost: true,
      setupCost: true,
    },
  },
  printingAreas: {
    select: { zecatAreaId: true, name: true, widthCm: true, heightCm: true },
  },
} satisfies Prisma.ProductSelect;

export type ProductoConImpresion = Prisma.ProductGetPayload<{ select: typeof SELECT_IMPRESION }>;

/// Lo minimo que hace falta para armar las opciones: sirve tanto el select de
/// arriba como el producto cacheado de la ficha (que trae las areas enteras).
export type ProductoParaOpciones = {
  printingLevels: ProductoConImpresion["printingLevels"];
  printingAreas: ProductoConImpresion["printingAreas"];
};

/// Precio unitario de una linea tal como se congela: Decimal(12,2). Postgres
/// redondea igual al guardar (HALF_UP para positivos); se hace ACA para que
/// lo que el cliente ve multiplicado sea exactamente lo que se guarda, y que
/// "cantidad x unitario" de el subtotal mostrado.
export function aCongelar(precio: Prisma.Decimal): Prisma.Decimal {
  return precio.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/// Opciones de personalizacion del producto, y el costo de cada nivel.
export function impresionDelProducto(p: ProductoParaOpciones) {
  const opciones = opcionesDeImpresion(
    p.printingLevels.map((l) => ({
      zecatTypeId: l.zecatTypeId,
      technique: l.technique,
      label: l.label,
      areaCm2: l.areaCm2 === null ? null : Number(l.areaCm2),
      zecatAreaIds: l.zecatAreaIds,
    })),
    p.printingAreas.map((a) => ({
      zecatAreaId: a.zecatAreaId,
      name: a.name,
      widthCm: a.widthCm === null ? null : Number(a.widthCm),
      heightCm: a.heightCm === null ? null : Number(a.heightCm),
    }))
  );
  const costoPorNivel = new Map(p.printingLevels.map((l) => [l.zecatTypeId, l]));
  return { opciones, costoPorNivel };
}


/// Una tarjeta de la ficha: una cantidad, el precio por unidad CON la
/// personalizacion estimada y el total de esas unidades. Todo ya formateado
/// (con centavos) para un client component: ahi no se hace ninguna cuenta.
export interface TarjetaCantidad {
  desde: number;
  /// Producto + personalizacion, por unidad: "$ 39.106,04".
  unitario: string;
  /// unitario x desde, exacto (sumado en centavos).
  total: string;
  /// Adicional del proveedor por cantidad chica a ESA cantidad, o null. Viaja
  /// el monto, nunca el umbral.
  adicional: string | null;
}

/// Lo que la ficha muestra de la personalizacion de un producto con niveles.
export interface FichaImpresion {
  technique: string;
  areaName: string;
  /// "Logo de hasta 3,1 × 3,1 cm".
  sizeLabel: string;
  /// Preparacion del logo, una vez por producto: "$ 67.570,00".
  preparacion: string;
  /// La opcion preseleccionada (la mas chica), para pedir el total.
  seleccion: { zecatTypeId: string; zecatAreaId: string };
  tarjetasPorSku: Record<string, TarjetaCantidad[]>;
}

type ProductoParaFicha = ProductoParaOpciones & {
  currency: Currency;
  minOrderQuantity: number | null;
  printingUnderMinimumCost: Prisma.Decimal | null;
  variants: Array<{ sku: string } & VariantDiscountInputs>;
};

/// Tarjetas por cantidad de la ficha (tanda 4c), con la MISMA logica que
/// /cotizar: las opciones salen de `impresionDelProducto`, la preseleccionada
/// es la mas chica (`opcionPorDefecto`), el precio de la personalizacion de
/// `computePrintingPrice` y el del producto de `computeSellPriceForQuantity`,
/// redondeado como se congela.
///
/// - Una tarjeta por escalon de la escala de la variante (1 y cada `min`).
///   Escalones consecutivos con el mismo unitario se colapsan, como en
///   `computeEscalones`.
/// - NUNCA una tarjeta EN el umbral (`minOrderQuantity`): seria publicar desde
///   cuantas unidades deja de cobrarse el adicional. Con umbral 1 (o sin
///   umbral) no hay adicional que revelar y la tarjeta de 1 unidad se queda.
/// - Devuelve null sin opciones (CDO, Zecat sin niveles o sin areas): la ficha
///   sigue con la tabla de precios y las leyendas de siempre.
///
/// `seleccion` es la que el cliente guardo en /cotizar (si la hay). Si es una
/// opcion valida de este producto, las tarjetas salen con ESE nivel, tecnica y
/// ubicacion, igual que el total; si no, con la mas chica, igual que /cotizar.
export function fichaDeImpresion(
  product: ProductoParaFicha,
  config: PricingInputs,
  seleccion?: unknown
): FichaImpresion | null {
  const { opciones, costoPorNivel } = impresionDelProducto(product);
  const resuelta = resolverSeleccion(opciones, seleccion);
  const elegida = resuelta.tipo === "ok" ? resuelta.opcion : opcionPorDefecto(opciones);
  if (!elegida) return null;
  const nivel = costoPorNivel.get(elegida.zecatTypeId)!;
  const umbral = product.minOrderQuantity ?? 0;

  const tarjetasPorSku: Record<string, TarjetaCantidad[]> = {};
  for (const v of product.variants) {
    const cortes = [1, ...parseDiscountTiers(v.discountTiers).map((t) => t.min)];
    const tarjetas: Array<TarjetaCantidad & { unitCentavos: number }> = [];
    for (const desde of [...new Set(cortes)].sort((a, b) => a - b)) {
      if (umbral > 1 && desde === umbral) continue;
      const producto = aCongelar(
        computeSellPriceForQuantity(v, product.currency, config, desde)
      );
      const impresion = computePrintingPrice(nivel, config, {
        productQuantity: desde,
        minOrderQuantity: product.minOrderQuantity,
        underMinimumCost: product.printingUnderMinimumCost,
      });
      const unitCentavos = aCentavos(producto) + aCentavos(impresion.unitPrice);
      const anterior = tarjetas.at(-1);
      if (
        anterior &&
        anterior.unitCentavos === unitCentavos &&
        (anterior.adicional === null) === (impresion.surcharge === null)
      ) {
        continue;
      }
      tarjetas.push({
        desde,
        unitCentavos,
        unitario: formatPriceArsCentavos(unitCentavos / 100),
        total: formatPriceArsCentavos((unitCentavos * desde) / 100),
        adicional: impresion.surcharge ? formatPriceArsCentavos(impresion.surcharge) : null,
      });
    }
    tarjetasPorSku[v.sku] = tarjetas.map((t) => ({
      desde: t.desde,
      unitario: t.unitario,
      total: t.total,
      adicional: t.adicional,
    }));
  }

  return {
    technique: elegida.technique,
    areaName: tituloArea(elegida.areaName),
    sizeLabel: elegida.sizeLabel,
    preparacion: formatPriceArsCentavos(computePrintingPrice(nivel, config).setupPrice),
    seleccion: { zecatTypeId: elegida.zecatTypeId, zecatAreaId: elegida.zecatAreaId },
    tarjetasPorSku,
  };
}

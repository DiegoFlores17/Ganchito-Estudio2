"use server";

import { formatPriceArsCentavos } from "@/lib/format";
import { centavosDeImpresion } from "@/lib/quote-printing";
import { fichaDeImpresion, type FichaImpresion } from "@/lib/impresion-producto";
import { getPricingConfig } from "@/lib/pricing";
import { getProductById } from "@/lib/product";
import { getQuoteItemsSummary } from "@/app/(store)/cotizar/actions";

/// Desglose del total estimado de la ficha. Todo formateado y con centavos;
/// sin umbral ni costos.
export interface DesgloseFicha {
  /// Total de unidades del producto: lo ya cotizado + lo que se agrega.
  cantidad: number;
  /// De esas, cuantas ya estan en la cotizacion del cliente.
  enCotizacion: number;
  producto: string;
  /// "11 x $ 1.272,23", o null si el cliente eligio no personalizar.
  personalizacionDetalle: string | null;
  personalizacion: string | null;
  preparacion: string | null;
  /// Adicional del proveedor por cantidad chica: el MONTO, o null.
  adicional: string | null;
  total: string;
}

type Linea = { variantSku: string; quantity: number };

/// Total estimado de la ficha (tanda 4c) para el PRODUCTO entero: lo que ya
/// esta en la cotizacion del cliente (`carrito`, por sku) mas lo que se esta
/// por agregar (`lineas`). Es exactamente lo que /cotizar va a ver, asi que el
/// escalon del producto y el adicional se deciden igual.
///
/// SIN cache a proposito: es una server action que lee la base en cada
/// llamada. Y no hace ninguna cuenta propia: arma el mismo resumen que
/// /cotizar (`getQuoteItemsSummary`) y suma con la misma funcion
/// (`centavosDeImpresion`), asi la ficha y /cotizar coinciden al centavo.
///
/// Devuelve null si el producto no tiene opciones de personalizacion (CDO,
/// Zecat sin niveles) o no hay nada que agregar.
export async function totalDeLaFicha(
  productId: string,
  lineas: Linea[],
  seleccion?: unknown,
  carrito: Record<string, number> = {}
): Promise<DesgloseFicha | null> {
  if (typeof productId !== "string" || !Array.isArray(lineas) || lineas.length === 0) {
    return null;
  }
  const delCarrito: Linea[] =
    typeof carrito === "object" && carrito !== null
      ? Object.entries(carrito).map(([variantSku, quantity]) => ({ variantSku, quantity }))
      : [];
  const items = [...delCarrito, ...lineas].map((l) => ({
    productId,
    variantSku: l?.variantSku,
    quantity: l?.quantity,
  }));
  const resumen = await getQuoteItemsSummary(
    items,
    seleccion === undefined ? undefined : { [productId]: seleccion }
  );
  const impresion = resumen.printing.find((p) => p.productId === productId);
  if (!impresion || resumen.items.length === 0) return null;

  const productoCentavos = resumen.items.reduce((sum, i) => sum + i.subtotalCentavos, 0);
  const opcion = impresion.opciones.find((o) => o.key === impresion.seleccion) ?? null;
  const montos = opcion
    ? centavosDeImpresion(opcion, impresion.quantity, impresion.surcharge)
    : null;
  const pesos = (centavos: number) => formatPriceArsCentavos(centavos / 100);
  // Lo que el resumen acepto del carrito (una variante que ya no existe se
  // omite, igual que en /cotizar).
  const skusVivos = new Set(resumen.items.map((i) => i.variantSku));
  const enCotizacion = delCarrito
    .filter((l) => skusVivos.has(l.variantSku) && Number.isInteger(l.quantity) && l.quantity > 0)
    .reduce((s, l) => s + l.quantity, 0);

  return {
    cantidad: impresion.quantity,
    enCotizacion,
    producto: pesos(productoCentavos),
    personalizacionDetalle: opcion
      ? `${impresion.quantity} x ${formatPriceArsCentavos(opcion.unitPrice)}`
      : null,
    personalizacion: montos ? pesos(montos.personalizacion) : null,
    preparacion: montos ? pesos(montos.preparacion) : null,
    adicional: montos && montos.adicional > 0 ? pesos(montos.adicional) : null,
    total: pesos(productoCentavos + (montos?.total ?? 0)),
  };
}

/// Tarjetas de la ficha para la seleccion que el cliente guardo en /cotizar.
/// Las de la pagina (cacheadas) salen con la opcion mas chica; si el cliente
/// eligio otra, toda la ficha tiene que mostrar ESA, o veria dos precios para
/// la misma eleccion. SIN cache: lee la base en cada llamada.
///
/// - "ninguna": `{ sinPersonalizar: true }`; la ficha muestra precios sin
///   personalizacion.
/// - Seleccion valida: las tarjetas con ese nivel.
/// - Invalida, o producto sin opciones: null (quedan las de la pagina).
export async function tarjetasDeLaFicha(
  productId: string,
  seleccion: unknown
): Promise<{ sinPersonalizar: true } | { sinPersonalizar: false; impresion: FichaImpresion } | null> {
  if (typeof productId !== "string") return null;
  if (seleccion === "ninguna") return { sinPersonalizar: true };
  const [product, config] = await Promise.all([getProductById(productId), getPricingConfig()]);
  if (!product) return null;
  const impresion = fichaDeImpresion(product, config, seleccion);
  if (!impresion) return null;
  const k = impresion.seleccion as { zecatTypeId: string; zecatAreaId: string };
  const pedida = seleccion as { zecatTypeId?: unknown; zecatAreaId?: unknown } | null;
  // Si la guardada no era valida, fichaDeImpresion cayo a la mas chica: eso ya
  // lo muestran las tarjetas de la pagina.
  if (!pedida || pedida.zecatTypeId !== k.zecatTypeId || pedida.zecatAreaId !== k.zecatAreaId) {
    return null;
  }
  return { sinPersonalizar: false, impresion };
}

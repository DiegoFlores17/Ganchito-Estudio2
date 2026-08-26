import { Prisma, UsdRateMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPricingConfig } from "@/lib/pricing";

/// De donde sale la cotizacion. Es texto porque se muestra tal cual en el
/// panel, y para que cambiar de fuente no pida una migracion.
export const FUENTE_OFICIAL = "Banco Nación (dolarapi.com)";
export const FUENTE_MANUAL = "Manual";

const URL_API = "https://dolarapi.com/v1/dolares/oficial";

/// Salto maximo aceptable contra el valor guardado, como fraccion.
///
/// Es una guarda contra basura, no contra el mercado: estas APIs gratuitas a
/// veces devuelven 0 o un valor de otra moneda, y un 0 pondria en CERO el
/// precio de todo el catalogo de CDO sin que nada falle. Un movimiento real
/// del oficial de mas del 20% en un dia existe, pero es tan raro que prefiero
/// que en ese caso alguien lo cargue a mano.
const SALTO_MAXIMO = 0.2;

export type UsdRateOutcome =
  /// Se consulto y se aplico a `usdRate`.
  | { status: "aplicado"; valor: number; anterior: number }
  /// Se consulto bien pero NO se aplico porque el modo es MANUAL. El oficial
  /// igual queda registrado.
  | { status: "solo-registrado"; valor: number; actual: number }
  /// La API respondio algo que no pasa la guarda de cordura.
  | { status: "rechazado"; valor: number; actual: number; motivo: string }
  /// No se pudo consultar. No se toca nada.
  | { status: "sin-respuesta"; motivo: string };

interface RespuestaDolarApi {
  compra?: number;
  venta?: number;
  fechaActualizacion?: string;
}

/// Trae el oficial del Banco Nacion.
///
/// Se usa `venta` y no `compra`: es lo que cuesta COMPRAR los dolares para
/// pagarle al proveedor. Con `compra` subestimariamos el costo.
async function fetchOficial(): Promise<number> {
  // Timeout explicito: sin esto, una API colgada deja el request del cron
  // esperando hasta que lo mate la plataforma.
  const res = await fetch(URL_API, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`dolarapi respondió ${res.status}`);

  const data = (await res.json()) as RespuestaDolarApi;
  const venta = Number(data.venta);

  if (!Number.isFinite(venta)) {
    throw new Error(`dolarapi devolvió un "venta" no numérico: ${data.venta}`);
  }
  return venta;
}

/// Valida el valor nuevo contra el guardado.
function validar(nuevo: number, actual: number): string | null {
  if (!Number.isFinite(nuevo) || nuevo <= 0) {
    return `el valor no es un número positivo (${nuevo})`;
  }
  // Sin valor previo no hay contra que comparar; alcanza con que sea > 0.
  if (actual <= 0) return null;

  const salto = Math.abs(nuevo - actual) / actual;
  if (salto > SALTO_MAXIMO) {
    return `salta ${(salto * 100).toFixed(1)}% contra el valor guardado (${actual} → ${nuevo}), más que el ${SALTO_MAXIMO * 100}% permitido`;
  }
  return null;
}

/// Consulta la API y actualiza la config segun el modo.
///
/// **Nunca deja `usdRate` en cero ni null.** Si algo falla, simplemente no
/// escribe ese campo: queda el ultimo valor conocido.
export async function refreshUsdRate(): Promise<UsdRateOutcome> {
  const config = await getPricingConfig();
  const actual = Number(config.usdRate);

  let oficial: number;
  try {
    oficial = await fetchOficial();
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    console.warn(`[usd-rate] no se pudo consultar la cotización: ${motivo}`);
    return { status: "sin-respuesta", motivo };
  }

  const problema = validar(oficial, actual);
  if (problema) {
    console.warn(`[usd-rate] valor RECHAZADO: ${problema}`);
    // Ni siquiera se registra como oficial: si el valor es basura, mostrarlo
    // en el panel como "el oficial hoy es 0" seria peor que no mostrarlo.
    return { status: "rechazado", valor: oficial, actual, motivo: problema };
  }

  // El oficial se registra SIEMPRE que sea valido, aplique o no. Es lo que
  // permite comparar en modo MANUAL sin cambiar nada.
  const comun = {
    usdRateOfficial: new Prisma.Decimal(oficial),
    usdRateOfficialAt: new Date(),
  };

  if (config.usdRateMode === UsdRateMode.MANUAL) {
    await prisma.pricingConfig.update({ where: { id: 1 }, data: comun });
    return { status: "solo-registrado", valor: oficial, actual };
  }

  await prisma.pricingConfig.update({
    where: { id: 1 },
    data: {
      ...comun,
      usdRate: new Prisma.Decimal(oficial),
      usdRateUpdatedAt: new Date(),
      usdRateSource: FUENTE_OFICIAL,
    },
  });

  return { status: "aplicado", valor: oficial, anterior: actual };
}

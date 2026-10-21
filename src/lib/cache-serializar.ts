import { Prisma } from "@prisma/client";

/// Ida y vuelta segura para la cache publica.
///
/// `unstable_cache` guarda el resultado como JSON, asi que lo que vuelve NO es
/// lo que entro: un `Prisma.Decimal` vuelve como string y un `Date` como
/// string ISO. Los consumidores (computeSellPrice, computePriceRange,
/// computeEscalones) llaman a `.times()`, `.dividedBy()`, `.getTime()`, etc.,
/// y con un string rompen o —peor— calculan mal sin avisar.
///
/// En vez de tocar cada consumidor, el lector cacheado serializa con marcas
/// explicitas ({ $dec } / { $fecha }) y rehidrata al volver: los
/// consumidores reciben exactamente los mismos tipos que con la base directa,
/// y el precio se calcula con la misma aritmetica Decimal que hoy.
///
/// Sin dependencias de Next: se prueba en scripts.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const MARCA_DECIMAL = "$dec";
const MARCA_FECHA = "$fecha";

export function serializar(valor: unknown): Json {
  if (valor === null || valor === undefined) return null;
  if (Prisma.Decimal.isDecimal(valor)) {
    return { [MARCA_DECIMAL]: (valor as Prisma.Decimal).toString() };
  }
  if (valor instanceof Date) {
    return { [MARCA_FECHA]: Number.isNaN(valor.getTime()) ? null : valor.toISOString() };
  }
  if (Array.isArray(valor)) return valor.map(serializar);
  if (typeof valor === "bigint") {
    // Los conteos de $queryRaw ya se pasan a Number antes de llegar aca.
    throw new Error("cache-serializar: un bigint no se puede guardar en la cache publica.");
  }
  if (typeof valor === "object") {
    const salida: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      // undefined se descarta, igual que lo hace JSON.stringify.
      if (v !== undefined) salida[k] = serializar(v);
    }
    return salida;
  }
  return valor as Json;
}

export function rehidratar<T>(valor: unknown): T {
  return rehidratarInterno(valor) as T;
}

function rehidratarInterno(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(rehidratarInterno);
  if (valor !== null && typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    const claves = Object.keys(o);
    if (claves.length === 1 && claves[0] === MARCA_DECIMAL && typeof o[MARCA_DECIMAL] === "string") {
      return new Prisma.Decimal(o[MARCA_DECIMAL] as string);
    }
    if (claves.length === 1 && claves[0] === MARCA_FECHA) {
      const f = o[MARCA_FECHA];
      return typeof f === "string" ? new Date(f) : new Date(NaN);
    }
    const salida: Record<string, unknown> = {};
    for (const k of claves) salida[k] = rehidratarInterno(o[k]);
    return salida;
  }
  return valor;
}

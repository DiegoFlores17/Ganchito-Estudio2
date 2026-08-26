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

/// Siglas y marcas que se escriben en mayuscula SIEMPRE. Sin esta lista,
/// "BPA FREE" quedaria como "Bpa Free" y "RPET" como "Rpet".
const SIGLAS = new Set([
  "BPA",
  "RPET",
  "PET",
  "INAL",
  "UV",
  "DTF",
  "LED",
  "USB",
  "ABS",
  "PVC",
  "OEKO",
  "TEX",
]);

/// Normaliza la capitalizacion de un atributo de producto para mostrarlo.
///
/// Los proveedores los mandan GRITADOS ("RECICLABLE", "MAYORMENTE
/// RECICLABLE") mezclados con otros en capitalizacion normal ("Industria
/// nacional", "Apto lavavajillas"). Todo en mayuscula grita en la ficha y
/// pelea con los titulos.
///
/// La regla es conservadora: **solo se toca lo que viene TODO en mayuscula.**
/// Una palabra que ya trae minusculas se deja intacta, porque ahi el
/// proveedor ya decidio como se escribe y adivinar solo puede empeorarlo
/// ("Apto lavavajillas" no tiene que volverse "Apto Lavavajillas").
///
/// Lo que se aplica es **sentence case**, no title case: en español
/// "Mayormente Reciclable" se lee raro, va "Mayormente reciclable".
///
/// **La excepcion es la sigla.** Cuando la frase arranca con una, lo que
/// sigue es un termino y no prosa: "BPA Free" es el nombre de la
/// caracteristica, no una oracion, asi que ahi la segunda palabra si va en
/// mayuscula. Por eso una palabra que viene despues de una sigla se
/// capitaliza igual que la primera.
export function formatAttributeName(name: string): string {
  const palabras = name.trim().split(/\s+/);

  return palabras
    .map((palabra, i) => {
      if (SIGLAS.has(palabra.toUpperCase())) return palabra.toUpperCase();

      // Ya viene con minusculas: el proveedor decidio, no lo tocamos.
      if (palabra !== palabra.toUpperCase()) return palabra;

      const anteriorEsSigla =
        i > 0 && SIGLAS.has(palabras[i - 1].toUpperCase());
      const vaEnMayuscula = i === 0 || anteriorEsSigla;

      return vaEnMayuscula
        ? palabra.charAt(0) + palabra.slice(1).toLowerCase()
        : palabra.toLowerCase();
    })
    .join(" ");
}

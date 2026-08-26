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
export function formatAttributeName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((palabra) => {
      if (SIGLAS.has(palabra.toUpperCase())) return palabra.toUpperCase();
      // Ya viene con minusculas: el proveedor decidio, no lo tocamos.
      if (palabra !== palabra.toUpperCase()) return palabra;
      return palabra.charAt(0) + palabra.slice(1).toLowerCase();
    })
    .join(" ");
}

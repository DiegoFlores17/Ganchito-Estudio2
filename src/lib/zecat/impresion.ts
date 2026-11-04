import { Prisma } from "@prisma/client";
import type { ZecatGenericProduct, ZecatPrintingType } from "./types";

/// Normalizacion y validacion de los precios de personalizacion de Zecat
/// (`printing_types` + `customization_under_minimum_extra_cost`).
///
/// Modulo PURO: sin base ni red, asi se prueba con los payloads reales
/// guardados (scripts/audit-verify-impresion.ts). El sync lo llama ANTES de
/// abrir la transaccion del producto.
///
/// El set de un producto es TODO O NADA. Si una sola fila no cumple, el set
/// entero es "roto": el producto se escribe con CERO niveles y sin recargo,
/// nunca con la mitad de los niveles ni con precios viejos. Un nivel suelto
/// con un precio equivocado se cotizaria mal sin que nada avise; un producto
/// sin niveles cae en "la personalizacion se cotiza aparte", que es honesto.
/// A diferencia del costo del producto (ZecatPricingError), esto NO pausa el
/// producto: pausar el catalogo porque Zecat renombre un campo de impresion
/// seria desproporcionado.

/// Un nivel ya normalizado, listo para escribir (y para hashear).
export interface NivelImpresion {
  zecatTypeId: string;
  technique: string;
  label: string;
  areaCm2: number | null;
  unitCost: number;
  setupCost: number;
  zecatAreaIds: string[];
}

export type ResultadoImpresion =
  | {
      tipo: "ok";
      /// Vacio si el producto no trae printing_types (no es un error).
      niveles: NivelImpresion[];
      /// Null si Zecat no manda el recargo.
      recargo: number | null;
    }
  | { tipo: "roto"; motivos: string[] };

/// Tope de lo que entra en Decimal(12,2). Un monto por encima no es un precio:
/// el create reventaria la transaccion del producto, asi que se trata como roto.
const MAX_MONTO = 9_999_999_999;
/// Decimal(10,2): el area es informativa, un valor fuera de rango se descarta.
const MAX_AREA = 99_999_999;

/// Un numero finito y >= 0, o null. Acepta el numero y el string numerico
/// ("95000"); rechaza null, "", booleanos, NaN e Infinity. Redondea a 2
/// decimales: es lo que guarda la columna, y asi el hash no ve diferencias
/// que la base no guarda.
function monto(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && v.trim() !== "") n = Number(v);
  else return null;
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONTO) return null;
  return Number(new Prisma.Decimal(n).toDecimalPlaces(2).toString());
}

function texto(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

export function normalizarImpresion(detail: ZecatGenericProduct): ResultadoImpresion {
  const motivos: string[] = [];

  // El recargo: ausente es valido (null); presente y no numerico, no.
  let recargo: number | null = null;
  const crudo = detail.customization_under_minimum_extra_cost;
  if (crudo !== null && crudo !== undefined) {
    recargo = monto(crudo);
    if (recargo === null) {
      motivos.push(`customization_under_minimum_extra_cost no es un monto valido (${JSON.stringify(crudo)})`);
    }
  }

  const niveles: NivelImpresion[] = [];
  const vistos = new Set<string>();
  const filas: ZecatPrintingType[] = Array.isArray(detail.printing_types) ? detail.printing_types : [];
  filas.forEach((fila, i) => {
    const donde = `printing_types[${i}]`;
    const id = texto(fila?.id);
    const name = texto(fila?.name);
    if (id === null) motivos.push(`${donde}: falta el id`);
    if (name === null) motivos.push(`${donde}${id ? ` (id ${id})` : ""}: falta el name`);

    const unitCost = monto(fila?.unit_price);
    const setupCost = monto(fila?.setup_price);
    if (unitCost === null) motivos.push(`${donde}${id ? ` (id ${id})` : ""}: unit_price no es un monto valido (${JSON.stringify(fila?.unit_price)})`);
    if (setupCost === null) motivos.push(`${donde}${id ? ` (id ${id})` : ""}: setup_price no es un monto valido (${JSON.stringify(fila?.setup_price)})`);

    // No sabemos modelar "primer logo gratis" ni "setup gratis": cobrar el
    // precio de lista seria cobrar de mas. Mejor que el set caiga a "se
    // cotiza aparte" que inventar un precio.
    if (fila?.first_logo_free === true) motivos.push(`${donde}${id ? ` (id ${id})` : ""}: first_logo_free es true`);
    if (fila?.setup_free === true) motivos.push(`${donde}${id ? ` (id ${id})` : ""}: setup_free es true`);

    if (id !== null) {
      if (vistos.has(id)) motivos.push(`${donde}: id ${id} duplicado`);
      vistos.add(id);
    }

    if (id === null || name === null || unitCost === null || setupCost === null) return;

    // Area: informativa. Invalida = null, no rompe el set.
    const areaCruda = fila.area;
    const area =
      typeof areaCruda === "number" || (typeof areaCruda === "string" && areaCruda.trim() !== "")
        ? Number(areaCruda)
        : NaN;
    const areaCm2 =
      Number.isFinite(area) && area >= 0 && area <= MAX_AREA
        ? Number(new Prisma.Decimal(area).toDecimalPlaces(2).toString())
        : null;

    // printing_area_id llega como NUMERO en configuration y como string en
    // printing_areas[].id: se normaliza a string para poder cruzarlos.
    const zecatAreaIds = [
      ...new Set(
        (fila.configuration?.printing_area_printing_types ?? [])
          .map((x) => texto(x?.printing_area_id))
          .filter((x): x is string => x !== null)
      ),
    ];

    niveles.push({
      zecatTypeId: id,
      technique: name,
      // Sin description, el label cae al name: no es un error.
      label: texto(fila.description) ?? name,
      areaCm2,
      unitCost,
      setupCost,
      zecatAreaIds,
    });
  });

  if (motivos.length > 0) return { tipo: "roto", motivos };
  return { tipo: "ok", niveles, recargo };
}

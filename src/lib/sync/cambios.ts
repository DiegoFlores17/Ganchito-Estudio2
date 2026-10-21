import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

/// Clasificacion de lo que cambio en un producto durante el sync, para decidir
/// QUE invalidar de la cache publica (ver lib/cache-tags.ts).
///
/// Modulo PURO y compartido por los conectores de Zecat y CDO: sin base ni
/// red, asi se prueba con casos sinteticos. Los conectores lo usan DENTRO de
/// la transaccion de cada producto.
///
/// Medido en local (Zecat, 4 dias): de 670 productos, 30 cambiaron algo
/// publico, 35 cruzaron el cero de stock y 211 movieron el stock sin cruzarlo.
/// A 3 minutos de distancia, 0 publicos. Invalidar por cada escritura del sync
/// tiraria la cache entera en cada corrida; invalidar solo lo que el cliente
/// nota la mantiene util.
///
/// El stock solo importa cuando cambia lo que el cliente LEE: agotado o con
/// stock. Un movimiento del numero sin cruzar el cero (incluso +-50 %) lo
/// absorbe el TTL; la ficha avisa si el pedido supera el stock informado.

export type ClaseCambio =
  /// Cambio algo visible: se invalida la ficha, el catalogo y el menu.
  | "publico"
  /// El stock disponible cruzo el cero, en cualquier sentido (se agoto o
  /// volvio): cambia el aviso "Quedan N" / "Consultar disponibilidad". Se
  /// invalida igual que un cambio publico.
  | "stock-cero"
  /// Algun otro cambio de stock: lo absorbe el TTL.
  | "stock-menor"
  | "sin-cambio";

/// Lo que se leyo de la base ANTES de escribir (una sola consulta). null =
/// producto nuevo.
export interface EstadoAnterior {
  publicHash: string | null;
  variantes: Array<{ sku: string; stock: number; reservedStock: number }>;
}

type Numerico = number | string | Prisma.Decimal | null | undefined;

/// Los datos publicos del producto, TAL COMO se van a escribir (ya
/// normalizados por el conector). Nada de stock ni de lastSyncedAt: eso no
/// cambia lo que se ve.
export interface DatosPublicos {
  name: string;
  description: string | null;
  currency: string;
  minOrderQuantity: number | null;
  heightCm: Numerico;
  widthCm: Numerico;
  lengthCm: Numerico;
  weightG: Numerico;
  active: boolean;
  categoryId: string | null;
  variantes: Array<{
    sku: string;
    colorName: string | null;
    colorHex: string | null;
    sizeName: string | null;
    materialName: string | null;
    costPrice: Numerico;
    discountPercent: Numerico;
    discountTiers: unknown;
    active: boolean;
  }>;
  imagenes: Array<{ url: string; isMain: boolean; sortOrder: number; variantSku: string | null }>;
  areasImpresion: Array<{ externalId: string; name: string; heightCm: Numerico; widthCm: Numerico }>;
  tiposImpresion: Array<{ name: string }>;
  atributos: Array<{ externalId: string | null; name: string; iconUrl: string | null }>;
}

/// Un numero en forma canonica: 10, "10.00" y Decimal(10) dan lo mismo.
function num(v: Numerico): string | null {
  if (v === null || v === undefined || v === "") return null;
  return new Prisma.Decimal(v).toString();
}

/// JSON con las claves ordenadas, para que el orden de insercion de un objeto
/// (la escala de descuentos viene de un Json) no cambie el hash.
function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonico(x)])
    );
  }
  if (v === undefined) return null;
  return v;
}

function ordenado<T>(filas: T[]): T[] {
  return [...filas].sort((a, b) => {
    const x = JSON.stringify(a);
    const y = JSON.stringify(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/// Hash determinista de lo publico. Donde el orden de entrada es arbitrario
/// (variantes, imagenes, areas, tipos, atributos) se ordena antes de hashear:
/// el proveedor puede devolver las mismas imagenes en otro orden de arreglo
/// sin que cambie nada. Ojo que `sortOrder` SI entra: es el orden de la
/// galeria que ve el cliente, asi que reordenarla de verdad es un cambio
/// publico.
export function calcularPublicHash(d: DatosPublicos): string {
  const payload = canonico({
    name: d.name,
    description: d.description,
    currency: d.currency,
    minOrderQuantity: d.minOrderQuantity,
    heightCm: num(d.heightCm),
    widthCm: num(d.widthCm),
    lengthCm: num(d.lengthCm),
    weightG: num(d.weightG),
    active: d.active,
    categoryId: d.categoryId,
    variantes: ordenado(
      d.variantes.map((v) => ({
        sku: v.sku,
        colorName: v.colorName,
        colorHex: v.colorHex,
        sizeName: v.sizeName,
        materialName: v.materialName,
        costPrice: num(v.costPrice),
        discountPercent: num(v.discountPercent),
        discountTiers: v.discountTiers ?? null,
        active: v.active,
      }))
    ),
    imagenes: ordenado(
      d.imagenes.map((i) => ({
        url: i.url,
        isMain: i.isMain,
        sortOrder: i.sortOrder,
        variantSku: i.variantSku,
      }))
    ),
    areasImpresion: ordenado(
      d.areasImpresion.map((a) => ({
        externalId: a.externalId,
        name: a.name,
        heightCm: num(a.heightCm),
        widthCm: num(a.widthCm),
      }))
    ),
    tiposImpresion: ordenado(d.tiposImpresion.map((t) => ({ name: t.name }))),
    atributos: ordenado(
      d.atributos.map((a) => ({ externalId: a.externalId, name: a.name, iconUrl: a.iconUrl }))
    ),
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/// Stock real (nunca el bruto).
function disponible(v: { stock: number; reservedStock: number }): number {
  return Math.max(0, v.stock - v.reservedStock);
}

/// Clasifica el cambio de un producto.
///
/// `variantesNuevas` trae el stock que se va a escribir (el hash no lo
/// incluye). Una variante que aparece o desaparece ya cambia el hash (el
/// conjunto de skus es parte de el), asi que el stock solo se compara en las
/// que estan de los dos lados.
export function clasificarCambio(
  anterior: EstadoAnterior | null,
  hashNuevo: string,
  variantesNuevas: Array<{ sku: string; stock: number; reservedStock: number }>
): ClaseCambio {
  if (!anterior || anterior.publicHash === null || anterior.publicHash !== hashNuevo) {
    return "publico";
  }

  const antes = new Map(anterior.variantes.map((v) => [v.sku, v]));
  let algunCambio = false;
  for (const nueva of variantesNuevas) {
    const vieja = antes.get(nueva.sku);
    if (!vieja) continue;
    if (vieja.stock !== nueva.stock || vieja.reservedStock !== nueva.reservedStock) algunCambio = true;
    const a = disponible(vieja);
    const b = disponible(nueva);
    if (a === b) continue;
    if (a > 0 !== b > 0) return "stock-cero";
  }
  return algunCambio ? "stock-menor" : "sin-cambio";
}

/// Si la clase obliga a invalidar la cache publica.
export function invalidaCache(clase: ClaseCambio): boolean {
  return clase === "publico" || clase === "stock-cero";
}

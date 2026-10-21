import { createHash } from "node:crypto";
import type { Currency, Prisma } from "@prisma/client";
import { normalizarNombre } from "@/lib/catalog-params";
import { APP_TIME_ZONE } from "@/lib/format";
import { computePriceRange, type PricingInputs } from "@/lib/pricing";

/// Destacados automaticos de la home: PURO, sin base de datos.
///
/// Lo que lee la base (candidatos, config de precios, rango) vive en
/// catalog.ts; aca solo se decide el orden. Asi se puede probar entero sin
/// levantar nada (scripts/audit-verify-destacados.ts).
///
/// Criterio, en este orden:
///   1. Precio dentro del rango editable (el de 1 unidad sin IVA, el mismo
///      numero que muestra la card: computePriceRange).
///   2. Una por categoria, para que la portada no sea ocho lapiceras.
///   3. Mas colores con stock primero, hasta un tope.
///   4. Rotacion diaria entre los empatados, para que la portada no sea
///      siempre la misma.

/// A partir de cuantos colores un producto ya "empata". Sin tope, el de 40
/// colores le ganaria siempre al de 7 y la portada seria siempre la misma;
/// con tope, los que llegan a 6 rotan entre si por dia.
export const TOPE_COLORES = 6;

/// Cuantos destacados muestra la home. Lo usan la home y la vista previa del
/// panel: una sola constante, para que las dos no puedan mostrar cantidades
/// distintas.
export const FEATURED_PRODUCTS_COUNT = 8;

/// Tope del rango: que el numero entre en Decimal(12,2) con holgura.
const RANGO_MAXIMO = 1_000_000_000;

/// Pesos ENTEROS de un campo del rango, como los escribe una persona en
/// Argentina: "5000", "5.000" o "5.000,00". Devuelve null si no es eso.
///
/// No se usa Number(): acepta "1e3" y "0x10", y lee "5.000" como 5 (punto
/// decimal). Por la misma razon el campo del formulario es de texto y no
/// type="number": el navegador ya mandaria 5.
///
/// Se rechazan los decimales que no son cero ("5.000,50"): el rango es para
/// elegir productos, no un precio, y un centavo ahi solo puede ser un error de
/// tipeo. Tambien "5.00" (ni miles bien formados ni un entero).
export function parsearPesosEnteros(crudo: string): number | null {
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,0{1,2})?$/.exec(crudo.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ""));
  return Number.isSafeInteger(n) && n <= RANGO_MAXIMO ? n : null;
}

export interface VarianteDestacable {
  costPrice: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
  stock: number;
  reservedStock: number;
  colorName: string | null;
}

export interface CandidatoDestacable {
  id: string;
  currency: Currency;
  /// Categoria a la que cuenta para "una por categoria": la canonica si la
  /// tiene (Escritura de Zecat y de CDO son la misma), si no la propia.
  grupo: string;
  /// Solo variantes ACTIVAS, como las lee la card.
  variants: VarianteDestacable[];
}

export type EtapaDestacado = "rango" | "relleno-precio" | "relleno-categoria";

export interface Destacado {
  id: string;
  etapa: EtapaDestacado;
  /// Colores distintos con stock (sin el tope: el panel muestra el real).
  colores: number;
  /// Precio de venta de 1 unidad sin IVA ("Desde" si las variantes difieren).
  precio: Prisma.Decimal;
}

export interface ResultadoDestacados {
  elegidos: Destacado[];
  stats: {
    /// Productos elegibles (con stock) cuyo precio cae en el rango hoy.
    productosEnRango: number;
    categoriasEnRango: number;
  };
}

/// Clave de un color para contar "colores distintos".
///
/// Zecat manda combinaciones ("Beige / Kaki / Beige / kaki", "Azul Mar / . /
/// Clip Blanco"): se parte por "/", se normaliza cada parte, se tiran las que
/// no tienen ni una letra (el "." de relleno) y se deduplica CONSERVANDO el
/// orden de aparicion. NO se ordena: "Negro / Naranja" y "Naranja / Negro"
/// son dos variantes reales distintas del Gorro TAHG 144.
///
/// No junta sinonimos ("Azul Francia" sigue separado de "Azul"): mismo
/// criterio que normalizarNombre.
export function claveDeColor(colorName: string | null): string | null {
  if (!colorName) return null;
  const partes: string[] = [];
  for (const cruda of colorName.split("/")) {
    const parte = normalizarNombre(cruda);
    if (!/[a-z]/.test(parte)) continue;
    if (!partes.includes(parte)) partes.push(parte);
  }
  return partes.length ? partes.join(" / ") : null;
}

const hayStock = (v: { stock: number; reservedStock: number }) => v.stock - v.reservedStock > 0;

/// Colores distintos entre las variantes con stock disponible.
export function contarColores(
  variants: Array<{ colorName: string | null; stock: number; reservedStock: number }>
): number {
  const claves = new Set<string>();
  for (const v of variants) {
    if (!hayStock(v)) continue;
    const clave = claveDeColor(v.colorName);
    if (clave) claves.add(clave);
  }
  return claves.size;
}

/// Desempate diario: md5 hex de id + fecha. Estable durante el dia, distinto
/// al dia siguiente, sin estado guardado en ningun lado.
export function claveDeRotacion(id: string, fecha: string): string {
  return createHash("md5").update(id + fecha).digest("hex");
}

/// Fecha "YYYY-MM-DD" en hora argentina. La zona va explicita: Vercel corre en
/// UTC y entre las 21:00 y las 23:59 ART ya seria el dia siguiente.
export function fechaArt(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

interface Puntuado {
  candidato: CandidatoDestacable;
  colores: number;
  score: number;
  rotacion: string;
  precio: Prisma.Decimal;
  enRango: boolean;
}

function mejorPrimero(a: Puntuado, b: Puntuado): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.rotacion !== b.rotacion) return a.rotacion < b.rotacion ? -1 : 1;
  // Solo si colisiona el md5: que el resultado no dependa del orden de entrada.
  return a.candidato.id < b.candidato.id ? -1 : a.candidato.id > b.candidato.id ? 1 : 0;
}

/// Elige hasta `cantidad` destacados, en etapas, sin repetir nunca un
/// producto. Cada etapa agrega DESPUES de la anterior:
///   1. "rango": en el rango de precio, uno por categoria.
///   2. "relleno-precio": se relaja SOLO el precio; sigue siendo uno por
///      categoria, y solo de categorias que todavia no salieron.
///   3. "relleno-categoria": se permite repetir categoria.
///   4. Si aun asi no alcanza, devuelve menos. Nunca se completa con otro
///      criterio (el viejo mostraba la cola del ultimo sync).
export function elegirDestacados(
  candidatos: CandidatoDestacable[],
  {
    priceMin,
    priceMax,
    fecha,
    cantidad,
    pricing,
    excluir,
    gruposUsados: gruposPrevios,
  }: {
    priceMin: number;
    priceMax: number;
    fecha: string;
    cantidad: number;
    pricing: PricingInputs;
    /// Ids que no se pueden elegir (los fijados a mano). Se descartan al
    /// ELEGIR, no antes de puntuar: los stats siguen siendo los del universo.
    excluir?: ReadonlySet<string>;
    /// Categorias que ya "salieron" (las de los fijados): cuentan como usadas
    /// en las etapas de una-por-categoria. La etapa 3 puede repetirlas.
    gruposUsados?: ReadonlySet<string>;
  }
): ResultadoDestacados {
  const puntuados: Puntuado[] = [];
  for (const candidato of candidatos) {
    // Sin stock no se elige, ni de relleno.
    if (!candidato.variants.some(hayStock)) continue;
    // El MISMO calculo que la card (piso "Desde" sobre las variantes activas,
    // 1 unidad, sin IVA), no una version parecida.
    const rango = computePriceRange(candidato.variants, candidato.currency, pricing);
    if (!rango) continue;
    const colores = contarColores(candidato.variants);
    puntuados.push({
      candidato,
      colores,
      score: Math.min(colores, TOPE_COLORES),
      rotacion: claveDeRotacion(candidato.id, fecha),
      precio: rango.min,
      enRango: rango.min.greaterThanOrEqualTo(priceMin) && rango.min.lessThanOrEqualTo(priceMax),
    });
  }
  puntuados.sort(mejorPrimero);

  const enRango = puntuados.filter((p) => p.enRango);
  const stats = {
    productosEnRango: enRango.length,
    categoriasEnRango: new Set(enRango.map((p) => p.candidato.grupo)).size,
  };

  const elegidos: Destacado[] = [];
  const usados = new Set<string>(excluir);
  const gruposUsados = new Set<string>(gruposPrevios);

  const tomar = (p: Puntuado, etapa: EtapaDestacado) => {
    usados.add(p.candidato.id);
    gruposUsados.add(p.candidato.grupo);
    elegidos.push({ id: p.candidato.id, etapa, colores: p.colores, precio: p.precio });
  };

  // `puntuados` ya esta ordenado, asi que "la mejor de cada categoria" es la
  // primera que aparece de cada una, y los elegidos salen en orden.
  const etapa = (fuente: Puntuado[], nombre: EtapaDestacado, unaPorCategoria: boolean) => {
    for (const p of fuente) {
      if (elegidos.length >= cantidad) return;
      if (usados.has(p.candidato.id)) continue;
      if (unaPorCategoria && gruposUsados.has(p.candidato.grupo)) continue;
      tomar(p, nombre);
    }
  };

  etapa(enRango, "rango", true);
  etapa(
    puntuados.filter((p) => !p.enRango),
    "relleno-precio",
    true
  );
  etapa(puntuados, "relleno-categoria", false);

  return { elegidos, stats };
}

// ---------------------------------------------------------------------------
//  Fijados a mano
// ---------------------------------------------------------------------------

/// Un producto con featuredRank, tal como lo lee la base (activo o no).
export interface ProductoFijado {
  id: string;
  /// Posicion pedida (1..cantidad). Fuera de ese rango se ignora.
  rank: number;
  /// Activo y no eliminado.
  activo: boolean;
  /// Tiene foto principal.
  conFoto: boolean;
  /// La categoria (resuelta a traves de la canonica) se ofrece como filtro.
  categoriaVisible: boolean;
  /// Mismo grupo que CandidatoDestacable.grupo; null si no tiene categoria.
  grupo: string | null;
  currency: Currency;
  /// Solo variantes ACTIVAS, como las lee la card.
  variants: VarianteDestacable[];
}

export type AdvertenciaFijado = "sin-stock" | "fuera-de-rango" | "categoria-oculta";
export type MotivoOmitido = "pausado-eliminado" | "sin-foto" | "sin-variantes" | "posicion-fuera-de-rango";

/// Un fijado que NO se muestra: su posicion la llena el automatico.
export interface FijadoOmitido {
  id: string;
  rank: number;
  motivo: MotivoOmitido;
}

/// Una posicion de la portada ya resuelta.
export interface PosicionDestacada {
  /// 1..cantidad. Puede haber huecos si el automatico se queda sin productos.
  posicion: number;
  id: string;
  origen: "fijado" | "automatico";
  /// Solo los automaticos tienen etapa.
  etapa: EtapaDestacado | null;
  colores: number;
  precio: Prisma.Decimal;
  /// Solo los fijados: lo que el automatico no habria elegido. Informativo,
  /// nunca bloquea: fijar es una decision humana.
  advertencias: AdvertenciaFijado[];
}

export interface ResultadoCombinado {
  /// Ordenadas por posicion.
  posiciones: PosicionDestacada[];
  omitidos: FijadoOmitido[];
  stats: ResultadoDestacados["stats"];
}

/// Combina los fijados a mano con el automatico. UNA sola funcion para la home
/// y para la vista previa del panel: asi el panel muestra exactamente lo que
/// muestra la home.
///
/// Reglas:
///   - Un fijado sale en SU posicion si esta activo, sin eliminar y con foto
///     principal. NO necesita estar en rango, tener stock ni estar en una
///     categoria visible: es una decision humana (se avisa, no se bloquea).
///   - Los que no cumplen eso se saltean y se informan; su posicion la llena
///     el automatico.
///   - El automatico llena las posiciones libres, en su orden, sin repetir
///     ids fijados, y las categorias de los fijados mostrados cuentan como
///     usadas en las etapas de una-por-categoria.
///   - Un rank fuera de 1..cantidad no se muestra, pero se informa como
///     omitido ("posicion-fuera-de-rango"): sigue ocupando el unique.
export function combinarConFijados(
  candidatos: CandidatoDestacable[],
  fijados: ProductoFijado[],
  opciones: { priceMin: number; priceMax: number; fecha: string; cantidad: number; pricing: PricingInputs }
): ResultadoCombinado {
  const { priceMin, priceMax, cantidad, pricing } = opciones;

  const omitidos: FijadoOmitido[] = [];
  const mostrados = new Map<number, PosicionDestacada>();
  const idsFijados = new Set<string>();
  const gruposFijados = new Set<string>();

  // Un rank fuera de 1..cantidad no se muestra, pero SIGUE ocupando el unique:
  // se informa (con su posicion real) para que el panel pueda soltarlo.
  const enRango = (f: ProductoFijado) => Number.isInteger(f.rank) && f.rank >= 1 && f.rank <= cantidad;
  for (const f of fijados.filter((x) => !enRango(x)).sort((a, b) => a.rank - b.rank)) {
    idsFijados.add(f.id);
    omitidos.push({ id: f.id, rank: f.rank, motivo: "posicion-fuera-de-rango" });
  }
  const validos = fijados.filter(enRango).sort((a, b) => a.rank - b.rank);

  for (const f of validos) {
    // Aunque no se muestre, su id no se vuelve a elegir de relleno: el que
    // lo fijo lo quiere en esa posicion, no en otra.
    idsFijados.add(f.id);
    if (!f.activo) {
      omitidos.push({ id: f.id, rank: f.rank, motivo: "pausado-eliminado" });
      continue;
    }
    if (!f.conFoto) {
      omitidos.push({ id: f.id, rank: f.rank, motivo: "sin-foto" });
      continue;
    }
    // Sin variantes no hay precio que mostrar en la card.
    const rango = computePriceRange(f.variants, f.currency, pricing);
    if (!rango) {
      omitidos.push({ id: f.id, rank: f.rank, motivo: "sin-variantes" });
      continue;
    }
    const advertencias: AdvertenciaFijado[] = [];
    if (!f.variants.some(hayStock)) advertencias.push("sin-stock");
    if (rango.min.lessThan(priceMin) || rango.min.greaterThan(priceMax)) advertencias.push("fuera-de-rango");
    if (!f.categoriaVisible) advertencias.push("categoria-oculta");
    if (f.grupo) gruposFijados.add(f.grupo);
    mostrados.set(f.rank, {
      posicion: f.rank,
      id: f.id,
      origen: "fijado",
      etapa: null,
      colores: contarColores(f.variants),
      precio: rango.min,
      advertencias,
    });
  }
  // Los omitidos no se pueden volver a elegir, pero tampoco tienen que
  // gastar la categoria ni el lugar: eso lo hace solo lo mostrado.

  const libres: number[] = [];
  for (let n = 1; n <= cantidad; n++) if (!mostrados.has(n)) libres.push(n);

  const auto = elegirDestacados(candidatos, {
    ...opciones,
    cantidad: libres.length,
    excluir: idsFijados,
    gruposUsados: gruposFijados,
  });
  auto.elegidos.forEach((e, i) => {
    const posicion = libres[i];
    mostrados.set(posicion, {
      posicion,
      id: e.id,
      origen: "automatico",
      etapa: e.etapa,
      colores: e.colores,
      precio: e.precio,
      advertencias: [],
    });
  });

  omitidos.sort((a, b) => a.rank - b.rank);
  return {
    posiciones: [...mostrados.values()].sort((a, b) => a.posicion - b.posicion),
    omitidos,
    stats: auto.stats,
  };
}

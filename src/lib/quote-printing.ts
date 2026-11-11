// Personalizacion en /cotizar (tanda 4b): que opciones se le ofrecen al
// cliente para un producto, como se rotulan y como se valida lo que vuelve.
//
// Modulo PURO (sin base ni red): lo usan las dos server actions de /cotizar y
// los scripts de verificacion. Al navegador viajan solo precios de venta y
// medidas: sin costos, sin la etiqueta de Zecat (los "KP") y sin el umbral.

/// Un nivel de impresion tal como lo lee el servidor (ProductPrintingLevel).
export interface NivelParaOfrecer {
  zecatTypeId: string;
  technique: string;
  label: string;
  areaCm2: number | null;
  zecatAreaIds: string[];
}

/// Un area de impresion del producto (PrintingArea).
export interface AreaParaOfrecer {
  zecatAreaId: string | null;
  name: string;
  widthCm: number | null;
  heightCm: number | null;
}

/// Una combinacion tecnica + ubicacion + tamano, del lado del servidor.
export interface OpcionInterna {
  key: string;
  zecatTypeId: string;
  zecatAreaId: string;
  technique: string;
  areaName: string;
  areaCm2: number;
  /// Etiqueta de Zecat ("Bordado 2KP"). Solo para el mail y el panel.
  levelLabel: string;
  /// "Logo de hasta 3,1 × 3,1 cm".
  sizeLabel: string;
}

/// Lo que se elige y se guarda en el navegador por producto.
export interface SeleccionImpresion {
  zecatTypeId: string;
  zecatAreaId: string;
}

/// Nombre de area para mostrar. Zecat los manda sucios ("DORSO Bordado",
/// "BORDADO"): aca solo se pasan a formato titulo, sin mapeos ni limpiezas por
/// texto (adivinar por el nombre acierta hoy y falla callado manana). Una
/// limpieza de verdad queda para una fase posterior.
export function tituloArea(nombre: string): string {
  return nombre
    .toLocaleLowerCase("es-AR")
    .replace(/(^|[\s/(-])(\p{L})/gu, (_, sep: string, letra: string) => sep + letra.toLocaleUpperCase("es-AR"));
}

export function claveOpcion(s: SeleccionImpresion): string {
  return `${s.zecatTypeId}:${s.zecatAreaId}`;
}

/// Lado del cuadrado de `cm2`, redondeado HACIA ABAJO a un decimal y con coma:
/// 10 cm² -> "3,1". Hacia abajo para no prometer un logo mas grande que el que
/// cubre el nivel.
function lado(cm2: number): string {
  const l = Math.floor(Math.sqrt(cm2) * 10) / 10;
  return l.toLocaleString("es-AR", { maximumFractionDigits: 1 });
}

/// Medida aproximada que ve el cliente. Nunca los "KP" de Zecat: el cliente
/// piensa en centimetros, no en miles de puntadas.
export function medidaAproximada(cm2: number): string {
  const l = lado(cm2);
  return `Logo de hasta ${l} × ${l} cm`;
}

/// Etiqueta publica de la seleccion: es la que se guarda en
/// QuoteItem.printingType y sale en el mensaje de WhatsApp.
export function etiquetaPublica(o: Pick<OpcionInterna, "technique" | "areaCm2" | "areaName">): string {
  const l = lado(o.areaCm2);
  return `${o.technique} · hasta ${l} × ${l} cm · ${tituloArea(o.areaName)} (estimado)`;
}

/// Las combinaciones que se ofrecen para un producto.
///
/// - Solo niveles con `areaCm2`: sin el area no hay medida que mostrar ni forma
///   de saber si el logo entra.
/// - Solo tecnicas con al menos un area del producto (en 5257, DTP, Serigrafia
///   Plana y Laser Rotativo CO2 no tienen ninguna: no se pueden ubicar).
/// - Si el area tiene medidas, solo los niveles que entran (`areaCm2` <= ancho
///   x alto). Sin medidas, no se filtra: no hay con que.
/// - Mismo tamano repetido en una tecnica y un area: queda el primero en el
///   orden de Zecat (no hay como elegir mejor sin el precio, que es aparte).
///
/// Ordenadas por tecnica, area y tamano, para que el selector salga estable.
export function opcionesDeImpresion(
  niveles: NivelParaOfrecer[],
  areas: AreaParaOfrecer[]
): OpcionInterna[] {
  const areaPorId = new Map(
    areas.flatMap((a) => (a.zecatAreaId ? [[a.zecatAreaId, a] as const] : []))
  );
  const opciones: OpcionInterna[] = [];
  const vistas = new Set<string>();
  for (const n of niveles) {
    if (n.areaCm2 === null || !(n.areaCm2 > 0)) continue;
    for (const areaId of n.zecatAreaIds) {
      const area = areaPorId.get(areaId);
      if (!area) continue;
      if (
        area.widthCm !== null &&
        area.heightCm !== null &&
        area.widthCm > 0 &&
        area.heightCm > 0 &&
        n.areaCm2 > area.widthCm * area.heightCm
      ) {
        continue;
      }
      const tamano = `${n.technique}|${areaId}|${n.areaCm2}`;
      if (vistas.has(tamano)) continue;
      vistas.add(tamano);
      opciones.push({
        key: claveOpcion({ zecatTypeId: n.zecatTypeId, zecatAreaId: areaId }),
        zecatTypeId: n.zecatTypeId,
        zecatAreaId: areaId,
        technique: n.technique,
        areaName: area.name,
        areaCm2: n.areaCm2,
        levelLabel: n.label,
        sizeLabel: medidaAproximada(n.areaCm2),
      });
    }
  }
  return opciones.sort(
    (a, b) =>
      a.technique.localeCompare(b.technique, "es") ||
      a.areaName.localeCompare(b.areaName, "es") ||
      a.areaCm2 - b.areaCm2
  );
}

/// La opcion preseleccionada: el nivel MAS CHICO entre todas (el empate lo
/// resuelve el orden de `opcionesDeImpresion`). Es el precio mas bajo
/// plausible y va marcado como estimado.
export function opcionPorDefecto(opciones: OpcionInterna[]): OpcionInterna | null {
  let elegida: OpcionInterna | null = null;
  for (const o of opciones) {
    if (!elegida || o.areaCm2 < elegida.areaCm2) elegida = o;
  }
  return elegida;
}

/// Lee la seleccion de un producto que llego del navegador.
///
/// - `ausente`: no vino nada (un carrito viejo, o una pestana abierta antes
///   del deploy). Se cotiza sin personalizacion y NO se marca: no hubo error.
/// - `ninguna`: el cliente eligio explicitamente "sin personalizar".
/// - `invalida`: vino algo que no es una opcion de ESTE producto (otra tecnica,
///   otra area, un tamano que no entra, o basura). Se cotiza sin
///   personalizacion y se marca para Ganchito. Nunca se rechaza.
export type SeleccionResuelta =
  | { tipo: "ausente" }
  | { tipo: "ninguna" }
  | { tipo: "invalida" }
  | { tipo: "ok"; opcion: OpcionInterna };

export function resolverSeleccion(
  opciones: OpcionInterna[],
  cruda: unknown
): SeleccionResuelta {
  if (cruda === undefined) return { tipo: "ausente" };
  if (cruda === null || cruda === "ninguna") return { tipo: "ninguna" };
  if (typeof cruda !== "object" || Array.isArray(cruda)) return { tipo: "invalida" };
  const { zecatTypeId, zecatAreaId } = cruda as Record<string, unknown>;
  if (typeof zecatTypeId !== "string" || typeof zecatAreaId !== "string") {
    return { tipo: "invalida" };
  }
  const key = claveOpcion({ zecatTypeId, zecatAreaId });
  const opcion = opciones.find((o) => o.key === key);
  return opcion ? { tipo: "ok", opcion } : { tipo: "invalida" };
}

/// Valida la forma del mapa productId -> seleccion que llega del navegador.
/// Lo que no es un objeto plano se ignora entero (equivale a "ausente" para
/// todos los productos). Las claves se toman tal cual: la validacion real es
/// `resolverSeleccion`, contra las opciones del producto.
export function leerSeleccionesCrudas(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

/// Texto de la marca interna cuando el servidor descarto una seleccion.
export const TEXTO_SELECCION_DESCARTADA =
  "La selección de personalización no era válida y se quitó: se cotizó sin personalizar.";

/// Parseo y construcción de la URL del catálogo.
///
/// **Existe para que haya UN solo lugar que sepa armar `/catalogo?...`.** Antes
/// cada control armaba la suya: el filtro de categorías preservaba `q`, el
/// buscador preservaba `categoria`, y el paginado los dos. Con tres filtros
/// más, cada control tendría que acordarse de los otros cinco parámetros — y
/// el que se olvide de uno lo BORRA en silencio al navegar.
///
/// No importa Prisma: lo usan componentes cliente.

/// Los filtros vigentes, ya parseados.
export interface CatalogFilters {
  q?: string;
  categoria?: string;
  page: number;
  /// Precio de VENTA en pesos (lo que ve el cliente), no costo.
  precioMin?: number;
  precioMax?: number;
  /// Nombres normalizados (ver `normalizarNombre`), no las grafías crudas.
  colores: string[];
  tecnicas: string[];
}

/// Lo que Next entrega en `searchParams`: cada clave puede venir repetida.
export type ParamsCrudos = Record<string, string | string[] | undefined>;

/// Colapsa GRAFÍAS del mismo texto: acentos, mayúsculas y espacios de más.
///
/// **No inventa sinónimos.** "Sublimación" y "Sublimacion" son el mismo dato
/// escrito distinto por dos proveedores, y hoy parten los resultados en dos
/// chips de 4 productos cada uno. En cambio "Serigrafía Plana" y "Serigrafía 1
/// color" siguen separadas, porque son técnicas distintas.
///
/// Es la misma línea que ya trazamos con los iconos de CDO y el mapeo de
/// categorías: unificar lo que es idéntico está bien, adivinar que dos nombres
/// parecidos significan lo mismo no. Agrupar "Royal Blue" bajo "Azul" cae del
/// lado prohibido y va a PENDIENTES como mapeo manual.
export function normalizarNombre(valor: string): string {
  return valor
    .normalize("NFD")
    // Los combining marks por punto de código, no como literales: escritos
    // literalmente son invisibles en el archivo y cualquier herramienta que
    // re-normalice el fuente los rompe sin dejar rastro.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function unSolo(valor: string | string[] | undefined): string | undefined {
  const v = Array.isArray(valor) ? valor[0] : valor;
  const limpio = v?.trim();
  return limpio ? limpio : undefined;
}

/// Multi-selección: parámetros REPETIDOS (`?color=Negro&color=Azul`) y no una
/// lista separada por comas. Hay nombres de color con barras y espacios
/// ("Beige / Kaki"), y el día que uno traiga una coma, el CSV parte el valor
/// en dos filtros que no existen.
function varios(valor: string | string[] | undefined): string[] {
  const lista = Array.isArray(valor) ? valor : valor ? [valor] : [];
  const vistos = new Set<string>();
  for (const v of lista) {
    const n = normalizarNombre(v);
    if (n) vistos.add(n);
  }
  return [...vistos];
}

/// Entero positivo o undefined. Nunca NaN: un NaN que llega a la query de
/// precios la vuelve `undefined` en silencio y el filtro deja de aplicarse sin
/// que nada falle.
function numero(valor: string | string[] | undefined): number | undefined {
  const v = unSolo(valor);
  if (v === undefined) return undefined;
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function parseCatalogParams(params: ParamsCrudos): CatalogFilters {
  const precioMin = numero(params.precioMin);
  const precioMax = numero(params.precioMax);

  return {
    q: unSolo(params.q),
    categoria: unSolo(params.categoria),
    page: Math.max(1, Math.floor(numero(params.page) ?? 1)),
    // Si vienen invertidos se ignora el par entero en vez de devolver cero
    // resultados: escribir 5000 en "hasta" y 10000 en "desde" es un error de
    // tipeo comun, y una grilla vacia no explica que paso.
    ...(precioMin !== undefined && precioMax !== undefined && precioMin > precioMax
      ? {}
      : { precioMin, precioMax }),
    colores: varios(params.color),
    tecnicas: varios(params.tecnica),
  };
}

/// Cambios a aplicar sobre los filtros vigentes. `null` borra el parámetro.
export type CambioFiltros = Partial<{
  q: string | null;
  categoria: string | null;
  page: number | null;
  precioMin: number | null;
  precioMax: number | null;
  colores: string[];
  tecnicas: string[];
}>;

/// Arma `/catalogo?...` con los filtros vigentes MÁS los cambios pedidos.
///
/// Cualquier cambio que no sea de página vuelve a la 1. Quedarse en `page=7`
/// al agregar un filtro es la forma más rápida de mostrarle una grilla vacía a
/// alguien que sí tiene resultados.
export function buildCatalogHref(
  actuales: CatalogFilters,
  cambios: CambioFiltros = {}
): string {
  const v = <T,>(cambio: T | null | undefined, actual: T): T | undefined =>
    cambio === null ? undefined : cambio === undefined ? actual : cambio;

  const q = v(cambios.q, actuales.q);
  const categoria = v(cambios.categoria, actuales.categoria);
  const precioMin = v(cambios.precioMin, actuales.precioMin);
  const precioMax = v(cambios.precioMax, actuales.precioMax);
  const colores = cambios.colores ?? actuales.colores;
  const tecnicas = cambios.tecnicas ?? actuales.tecnicas;

  const soloPagina = Object.keys(cambios).length === 1 && "page" in cambios;
  const page = soloPagina ? (v(cambios.page, actuales.page) ?? 1) : 1;

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (categoria) params.set("categoria", categoria);
  if (precioMin !== undefined) params.set("precioMin", String(precioMin));
  if (precioMax !== undefined) params.set("precioMax", String(precioMax));
  for (const c of colores) params.append("color", c);
  for (const t of tecnicas) params.append("tecnica", t);
  if (page > 1) params.set("page", String(page));

  const query = params.toString();
  return query ? `/catalogo?${query}` : "/catalogo";
}

/// Alterna un valor dentro de una multi-selección.
export function alternar(lista: string[], valor: string): string[] {
  const n = normalizarNombre(valor);
  return lista.includes(n) ? lista.filter((x) => x !== n) : [...lista, n];
}

/// Si hay algún filtro aplicado además de la categoría y la búsqueda.
export function hayFiltrosDeFaceta(f: CatalogFilters): boolean {
  return (
    f.precioMin !== undefined ||
    f.precioMax !== undefined ||
    f.colores.length > 0 ||
    f.tecnicas.length > 0
  );
}

/// Si hay CUALQUIER filtro aplicado. Lo usa el "Borrar filtros" para saber si
/// tiene sentido mostrarse.
export function hayAlgunFiltro(f: CatalogFilters): boolean {
  return hayFiltrosDeFaceta(f) || !!f.q || !!f.categoria;
}

// ---------------------------------------------------------------------------
//  Tipos y constantes de las opciones del panel
// ---------------------------------------------------------------------------
//
// Viven ACA y no en `catalog.ts` porque los usa el panel, que es un componente
// cliente, y `catalog.ts` importa Prisma en el tope. Un `import type` se borra
// al compilar y no molesta, pero COLORES_VISIBLES es un VALOR: importarlo
// desde el cliente arrastraba Prisma al bundle del navegador y volteaba el
// build con "Module not found: Can't resolve 'dns'".
//
// Es el mismo caso que ya nos pasó con WHATSAPP_MENSAJE_DEFECTO. Y ojo: `tsc`
// y eslint pasan limpios igual — esto solo lo detecta el build.

/// Cuántos colores se muestran antes del "ver más". Hay 234 valores distintos
/// en la base: mostrarlos todos convierte el panel en una lista inmanejable, y
/// los primeros concentran casi todo el catálogo (Negro 449, Blanco 211).
export const COLORES_VISIBLES = 16;

/// Una opción del panel: el valor que viaja en la URL, la etiqueta que se
/// muestra, y cuántos productos tiene.
export interface OpcionFiltro {
  /// Nombre normalizado. Es lo que va a la URL.
  valor: string;
  /// La grafía más frecuente del grupo, que es la que se muestra.
  etiqueta: string;
  productos: number;
  /// Solo para colores, y solo cuando alguna variante lo trae: el 75% de las
  /// variantes NO tiene colorHex, así que el chip no puede ser un círculo de
  /// color — es texto, con un punto al lado cuando hay dato.
  hex?: string;
}

export interface CatalogFilterOptions {
  colores: OpcionFiltro[];
  tecnicas: OpcionFiltro[];
  /// Rango de precios de VENTA para los placeholders, ya redondeado.
  precioPiso: number;
  precioTecho: number;
}

/// Formato corto y sin decimales. En un chip de filtro o en un placeholder,
/// los centavos son ruido.
///
/// Vive ACA y no en el panel por el mismo motivo que COLORES_VISIBLES, pero
/// al reves: `ActiveFilters` es un Server Component y el panel es
/// `"use client"`. Llamar una funcion de un modulo cliente desde el servidor
/// falla en RENDER ("Attempted to call formatearPeso() from the server"),
/// no al compilar: tsc, eslint y `next build` pasan limpios igual.
export function formatearPeso(n: number): string {
  return `$ ${n.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

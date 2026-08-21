import { prisma } from "@/lib/prisma";

/// De donde salio la categoria. No es una columna: se deduce de cual de los
/// dos ids externos tiene cargado.
export type CategoryOrigin = "ZECAT" | "CDO" | "PROPIA";

export interface AdminCategoryRow {
  id: string;
  name: string;
  slug: string;
  visible: boolean;
  origin: CategoryOrigin;
  /// Productos vivos colgados DIRECTAMENTE de esta categoria. Los eliminados
  /// y los pausados no cuentan: el numero esta para decidir si vale la pena
  /// ofrecerla como filtro, y una categoria con 0 productos visibles no le
  /// sirve a nadie.
  productCount: number;
  /// Si es alias, a que categoria apunta.
  canonicalId: string | null;
  canonicalName: string | null;
}

/// Una categoria propia con los alias que le apuntan. Es lo que ve el
/// cliente en el filtro.
export interface CanonicalGroup extends AdminCategoryRow {
  aliases: AdminCategoryRow[];
  /// Lo que de verdad muestra el filtro: los productos propios MAS los de
  /// todos sus alias. Es el numero que importa para decidir el mapeo.
  totalProductCount: number;
}

export interface AdminCategoriesView {
  /// Categorias propias (las de la tienda). Son las candidatas a canonicas.
  canonicals: CanonicalGroup[];
  /// Categorias de proveedor que NO son alias de ninguna: hoy aparecen
  /// solas en el filtro.
  unassigned: AdminCategoryRow[];
  /// Pares que se llaman parecido y todavia no estan unificados. Es una
  /// SUGERENCIA para mirar, nunca se aplica sola.
  suggestions: CategorySuggestion[];
  totalCount: number;
  hiddenCount: number;
}

export interface CategorySuggestion {
  /// Nombre normalizado que comparten.
  key: string;
  members: AdminCategoryRow[];
}

function resolveOrigin(category: {
  zecatFamilyId: string | null;
  cdoCategoryId: string | null;
}): CategoryOrigin {
  if (category.zecatFamilyId) return "ZECAT";
  if (category.cdoCategoryId) return "CDO";
  return "PROPIA";
}

/// Normaliza para COMPARAR nombres, no para mostrarlos: saca acentos, pasa a
/// minusculas y colapsa lo que no sea alfanumerico.
///
/// Solo se usa para SUGERIR. La union nunca se aplica sola: "Escritorio" y
/// "Escritura" se parecen y son cosas distintas, y al reves "Hogar" y "Hogar
/// y Tiempo Libre" son lo mismo y no matchean. Cualquier automatismo sobre
/// esto acierta hoy y falla callado manana — el mismo criterio que ya se
/// aplico a los iconos de CDO.
export function normalizeForMatch(name: string): string {
  return name
    .normalize("NFD")
    // Escapes explicitos y no las marcas literales: escritas a mano
    // sobreviven mal a copiar y pegar entre editores.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/// Todas las categorias agrupadas para la pantalla del panel.
export async function getAdminCategoriesView(): Promise<AdminCategoriesView> {
  const categories = await prisma.category.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      visible: true,
      canonicalId: true,
      zecatFamilyId: true,
      cdoCategoryId: true,
      canonical: { select: { name: true } },
      _count: {
        select: {
          products: { where: { deletedAt: null, active: true } },
        },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  const rows: AdminCategoryRow[] = categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    visible: category.visible,
    origin: resolveOrigin(category),
    productCount: category._count.products,
    canonicalId: category.canonicalId,
    canonicalName: category.canonical?.name ?? null,
  }));

  const aliasesByCanonical = new Map<string, AdminCategoryRow[]>();
  for (const row of rows) {
    if (!row.canonicalId) continue;
    const list = aliasesByCanonical.get(row.canonicalId) ?? [];
    list.push(row);
    aliasesByCanonical.set(row.canonicalId, list);
  }

  // Las canonicas son las propias. Una categoria de proveedor puede llegar a
  // tener alias si alguien lo forzo antes de una validacion, asi que se
  // incluye igual para que no quede invisible en la pantalla.
  const canonicals: CanonicalGroup[] = rows
    .filter(
      (row) =>
        !row.canonicalId &&
        (row.origin === "PROPIA" || aliasesByCanonical.has(row.id))
    )
    .map((row) => {
      const aliases = aliasesByCanonical.get(row.id) ?? [];
      return {
        ...row,
        aliases,
        totalProductCount:
          row.productCount + aliases.reduce((n, a) => n + a.productCount, 0),
      };
    });

  const canonicalIds = new Set(canonicals.map((c) => c.id));
  const unassigned = rows.filter(
    (row) => !row.canonicalId && !canonicalIds.has(row.id)
  );

  return {
    canonicals,
    unassigned,
    suggestions: buildSuggestions(unassigned),
    totalCount: rows.length,
    hiddenCount: rows.filter((r) => !r.visible).length,
  };
}

/// Agrupa las sueltas por nombre normalizado y devuelve los grupos de 2 o mas.
///
/// Se calcula SOLO sobre las que todavia no estan unificadas: una vez que se
/// resolvio un par, deja de sugerirse.
function buildSuggestions(rows: AdminCategoryRow[]): CategorySuggestion[] {
  const groups = new Map<string, AdminCategoryRow[]>();
  for (const row of rows) {
    const key = normalizeForMatch(row.name);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({ key, members }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/// Las categorias que pueden recibir alias, para el selector de "Unificar
/// con...". Solo propias y que no sean alias ellas mismas: sin esto se
/// podrian armar cadenas (A -> B -> C) que el filtro del catalogo no
/// resuelve, porque solo mira un nivel.
export async function getCanonicalOptions() {
  return prisma.category.findMany({
    where: {
      canonicalId: null,
      zecatFamilyId: null,
      cdoCategoryId: null,
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

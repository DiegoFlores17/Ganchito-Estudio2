import { prisma } from "@/lib/prisma";

/// Categorias elegidas a mano para la home (ver PENDIENTES.md sobre limpiar
/// las categorias del catalogo): de las 27 categorias reales de Zecat, estas
/// son las de mayor volumen que NO son campanas ni ofertas temporales
/// ("2026 Agro", "70%OFF...", "Proximos Arribos", etc). El producto de cada
/// una se eligio a mano por su foto (ver conversacion), no es automatico.
///
/// Se referencia por zecatId (el id externo de la API de Zecat), NUNCA por
/// Product.id: el cuid interno de Prisma lo genera cada base al crear la
/// fila, asi que es DISTINTO entre local y produccion aunque sea "el mismo"
/// producto. zecatId en cambio viene de la fuente y es igual en cualquier
/// entorno sincronizado.
const HOME_CATEGORY_PICKS = [
  {
    name: "Bolsos y Mochilas",
    slug: "bolsos-y-mochilas-corporativas",
    zecatId: "5190", // Bolso Expand
  },
  {
    name: "Drinkware",
    slug: "termos-corporativos-y-drinkware",
    zecatId: "5742", // Botella Calypso
  },
  {
    name: "Indumentaria",
    slug: "Abrigos",
    zecatId: "5704", // Campera Stream Men
  },
  {
    name: "Tecnologia",
    slug: "regalos-tecnologicos-corporativos",
    zecatId: "5194", // Auriculares Tempo
  },
  {
    name: "Escritura",
    slug: "boligrafos-corporativos",
    zecatId: "5046", // Boligrafo COSMIC
  },
  {
    name: "Viajes",
    slug: "viajes",
    zecatId: "5268", // Mochila FLIGHT
  },
] as const;

export interface HomeCategoryTile {
  name: string;
  slug: string;
  imageUrl: string | null;
}

export async function getHomeCategoryShowcase(): Promise<HomeCategoryTile[]> {
  const products = await prisma.product.findMany({
    where: {
      zecatId: { in: HOME_CATEGORY_PICKS.map((p) => p.zecatId) },
    },
    select: {
      zecatId: true,
      images: { where: { isMain: true }, take: 1, select: { url: true } },
    },
  });
  const imageByZecatId = new Map(
    products.map((p) => [p.zecatId, p.images[0]?.url ?? null])
  );

  return HOME_CATEGORY_PICKS.map((pick) => ({
    name: pick.name,
    slug: pick.slug,
    imageUrl: imageByZecatId.get(pick.zecatId) ?? null,
  }));
}

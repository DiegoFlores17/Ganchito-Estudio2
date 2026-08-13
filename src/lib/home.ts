import { prisma } from "@/lib/prisma";

/// Categorias elegidas a mano para la home (ver PENDIENTES.md sobre limpiar
/// las categorias del catalogo): de las 27 categorias reales de Zecat, estas
/// son las de mayor volumen que NO son campanas ni ofertas temporales
/// ("2026 Agro", "70%OFF...", "Proximos Arribos", etc). El producto de cada
/// una se eligio a mano por su foto (ver conversacion), no es automatico.
const HOME_CATEGORY_PICKS = [
  {
    name: "Bolsos y Mochilas",
    slug: "bolsos-y-mochilas-corporativas",
    representativeProductId: "cmshyfesy08b37lsxkenafazc",
  },
  {
    name: "Drinkware",
    slug: "termos-corporativos-y-drinkware",
    representativeProductId: "cmshyi8d00etb7lsxoukki46e",
  },
  {
    name: "Indumentaria",
    slug: "Abrigos",
    representativeProductId: "cmshyhy9e0duq7lsxjqxs94iu",
  },
  {
    name: "Tecnologia",
    slug: "regalos-tecnologicos-corporativos",
    representativeProductId: "cmshyffme08de7lsxfqelrobt",
  },
  {
    name: "Escritura",
    slug: "boligrafos-corporativos",
    representativeProductId: "cmshyexbl074j7lsxaa7ja3qn",
  },
  {
    name: "Viajes",
    slug: "viajes",
    representativeProductId: "cmshyfoyq09ae7lsxkxph9i6a",
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
      id: { in: HOME_CATEGORY_PICKS.map((p) => p.representativeProductId) },
    },
    select: {
      id: true,
      images: { where: { isMain: true }, take: 1, select: { url: true } },
    },
  });
  const imageById = new Map(products.map((p) => [p.id, p.images[0]?.url ?? null]));

  return HOME_CATEGORY_PICKS.map((pick) => ({
    name: pick.name,
    slug: pick.slug,
    imageUrl: imageById.get(pick.representativeProductId) ?? null,
  }));
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FEATURED_PRODUCTS_COUNT } from "@/lib/destacados";
import { computePriceRange, getPricingConfig } from "@/lib/pricing";

/// Escritura y busqueda de los destacados FIJADOS a mano (Product.featuredRank).
///
/// Vive aparte de las acciones del panel para poder probarse sin sesion: las
/// acciones (destacados/actions.ts) piden requireAdmin, llaman a esto e
/// invalidan la cache. Esto NO invalida nada ni importa la cache publica.
///
/// El unico invariante que sostiene la base es el @unique de featuredRank:
/// una posicion, un producto. Por eso cada cambio libera primero lo que va a
/// ocupar, todo dentro de una transaccion.

export interface ResultadoFijado {
  success: boolean;
  error?: string;
}

export interface ProductoParaFijar {
  id: string;
  name: string;
  imageUrl: string | null;
  /// La categoria que ve el cliente (la canonica si la tiene).
  categoryName: string | null;
  /// Precio de 1 unidad sin IVA ("Desde" si las variantes difieren).
  precio: number;
  desde: boolean;
  tieneStock: boolean;
  /// Posicion en la que ya esta fijado, o null.
  fijadoEn: number | null;
}

export type ResultadoBusqueda =
  | { success: true; productos: ProductoParaFijar[] }
  | { success: false; error: string };

const MINIMO_BUSQUEDA = 2;
const MAXIMO_RESULTADOS = 20;
/// Tope del texto buscado: nadie escribe mas, y evita patrones gigantes en la query.
const MAXIMO_TEXTO = 100;

const posicionValida = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= FEATURED_PRODUCTS_COUNT;

const ERROR_POSICION = `La posición tiene que ser un número entre 1 y ${FEATURED_PRODUCTS_COUNT}.`;
const ERROR_CONFLICTO = "Otra persona cambió los destacados al mismo tiempo. Actualizá la página y probá de nuevo.";

/// Dos personas tocando la misma posicion a la vez: la base rechaza la
/// segunda (unique, P2002) o detecta el deadlock de dos intercambios cruzados
/// (con el adaptador de pg llega como P2039; P2034 es el write conflict del
/// motor). No es un error del programa, es una carrera: se informa y se
/// reintenta a mano.
function esConflicto(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.code === "P2002" || e.code === "P2034" || e.code === "P2039")
  );
}

/// Fija un producto en una posicion. Si la posicion estaba ocupada, el que
/// estaba vuelve al automatico; si el producto estaba fijado en otra, se mueve.
export async function fijarProducto(productId: string, posicion: number): Promise<ResultadoFijado> {
  if (!posicionValida(posicion)) return { success: false, error: ERROR_POSICION };
  if (typeof productId !== "string" || productId.length === 0) {
    return { success: false, error: "Elegí un producto." };
  }
  try {
    return await prisma.$transaction(async (tx): Promise<ResultadoFijado> => {
      const p = await tx.product.findUnique({
        where: { id: productId },
        select: { active: true, deletedAt: true, images: { where: { isMain: true }, take: 1, select: { id: true } } },
      });
      if (!p || p.deletedAt) return { success: false, error: "El producto no existe o fue eliminado." };
      if (!p.active) return { success: false, error: "El producto está pausado: activalo antes de fijarlo." };
      if (p.images.length === 0) return { success: false, error: "El producto no tiene foto principal." };

      // Primero se libera la posicion (sin tocar al propio producto), despues
      // se ocupa. El producto tiene un solo rank, asi que el update lo saca
      // solo de donde estaba.
      await tx.product.updateMany({
        where: { featuredRank: posicion, id: { not: productId } },
        data: { featuredRank: null },
      });
      await tx.product.update({ where: { id: productId }, data: { featuredRank: posicion } });
      return { success: true };
    });
  } catch (e) {
    if (esConflicto(e)) return { success: false, error: ERROR_CONFLICTO };
    throw e;
  }
}

const ERROR_DESACTUALIZADO =
  "Otra persona cambió los destacados mientras tenías esta pantalla abierta. Actualizá la página y probá de nuevo.";

/// Vuelve una posicion al automatico, pero SOLO si todavia la ocupa el producto
/// que la pantalla mostraba: soltar "lo que haya en la posicion N" desde una
/// pestana vieja soltaria al que otra persona acaba de fijar.
///
/// Acepta cualquier rank entero (no solo 1..N): un fijado con rank fuera de
/// rango sigue ocupando el unique y el panel tiene que poder soltarlo.
export async function soltarPosicion(posicion: number, productId: string): Promise<ResultadoFijado> {
  if (!Number.isInteger(posicion)) return { success: false, error: "La posición no es válida." };
  if (typeof productId !== "string" || productId.length === 0) {
    return { success: false, error: "Falta el producto a soltar." };
  }
  const r = await prisma.product.updateMany({
    where: { id: productId, featuredRank: posicion },
    data: { featuredRank: null },
  });
  return r.count === 1 ? { success: true } : { success: false, error: ERROR_DESACTUALIZADO };
}

/// Mueve el fijado `productId` de una posicion a la vecina. Si la vecina tiene
/// otro fijado se intercambian; si es automatica, solo se mueve el rank. Si la
/// posicion ya no tiene a ese producto, no hace nada.
export async function moverPosicion(
  posicion: number,
  direccion: "arriba" | "abajo",
  productId: string
): Promise<ResultadoFijado> {
  if (!posicionValida(posicion)) return { success: false, error: ERROR_POSICION };
  if (direccion !== "arriba" && direccion !== "abajo") {
    return { success: false, error: "Dirección inválida." };
  }
  if (typeof productId !== "string" || productId.length === 0) {
    return { success: false, error: "Falta el producto a mover." };
  }
  const vecina = direccion === "arriba" ? posicion - 1 : posicion + 1;
  if (!posicionValida(vecina)) {
    return { success: false, error: "Ya está en el borde: no se puede mover más en esa dirección." };
  }
  try {
    return await prisma.$transaction(async (tx): Promise<ResultadoFijado> => {
      // Se bloquean las dos filas (si existen) en un orden fijo, el de id: dos
      // intercambios cruzados esperan en fila en vez de pisarse o darse por
      // deadlock, y lo que se lee abajo ya no puede cambiar hasta el commit.
      const filas = await tx.$queryRaw<{ id: string; featuredRank: number }[]>`
        SELECT id, "featuredRank" FROM products
        WHERE "featuredRank" IN (${posicion}, ${vecina})
        ORDER BY id
        FOR UPDATE
      `;
      const a = filas.find((f) => f.featuredRank === posicion);
      if (!a || a.id !== productId) return { success: false, error: ERROR_DESACTUALIZADO };
      const b = filas.find((f) => f.featuredRank === vecina);
      // Con el @unique no hay estado intermedio con dos en la misma
      // posicion: a pasa por null, b ocupa el lugar de a, a ocupa el de b.
      await tx.product.update({ where: { id: a.id }, data: { featuredRank: null } });
      if (b) await tx.product.update({ where: { id: b.id }, data: { featuredRank: posicion } });
      await tx.product.update({ where: { id: a.id }, data: { featuredRank: vecina } });
      return { success: true };
    });
  } catch (e) {
    if (esConflicto(e)) return { success: false, error: ERROR_CONFLICTO };
    throw e;
  }
}

/// Productos que se pueden fijar (activos, sin eliminar, con foto principal y
/// alguna variante activa) que coincidan con el texto en nombre, codigo del
/// proveedor o sku de variante. Sin acentos ni mayusculas: mismo mecanismo
/// (unaccent + ILIKE parametrizado) que la busqueda de la tienda.
export async function buscarProductosParaFijar(texto: string): Promise<ResultadoBusqueda> {
  const limpio = typeof texto === "string" ? texto.trim().slice(0, MAXIMO_TEXTO).trim() : "";
  if (limpio.length < MINIMO_BUSQUEDA) {
    return { success: false, error: `Escribí al menos ${MINIMO_BUSQUEDA} letras.` };
  }
  // Los comodines de LIKE que escribe una persona ("100%", "a_b") son texto.
  const patron = "%" + limpio.replace(/[\\%_]/g, "\\$&") + "%";
  const filas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id
    FROM products p
    WHERE p.active = true
      AND p."deletedAt" IS NULL
      AND EXISTS (SELECT 1 FROM product_images i WHERE i."productId" = p.id AND i."isMain" = true)
      AND EXISTS (SELECT 1 FROM product_variants va WHERE va."productId" = p.id AND va.active = true)
      AND (
        unaccent(p.name) ILIKE unaccent(${patron}) OR
        p."externalId" ILIKE ${patron} OR
        EXISTS (SELECT 1 FROM product_variants v WHERE v."productId" = p.id AND v.sku ILIKE ${patron})
      )
    ORDER BY p.name
    LIMIT ${MAXIMO_RESULTADOS}
  `;
  if (filas.length === 0) return { success: true, productos: [] };

  const [productos, pricing] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: filas.map((f) => f.id) } },
      select: {
        id: true,
        name: true,
        currency: true,
        featuredRank: true,
        category: { select: { name: true, canonical: { select: { name: true } } } },
        images: { where: { isMain: true }, take: 1, select: { url: true } },
        variants: {
          where: { active: true },
          select: { stock: true, reservedStock: true, costPrice: true, discountPercent: true },
        },
      },
    }),
    getPricingConfig(),
  ]);
  const porId = new Map(productos.map((p) => [p.id, p]));
  return {
    success: true,
    productos: filas.flatMap(({ id }) => {
      const p = porId.get(id);
      const rango = p ? computePriceRange(p.variants, p.currency, pricing) : null;
      if (!p || !rango) return [];
      return {
        id: p.id,
        name: p.name,
        imageUrl: p.images[0]?.url ?? null,
        categoryName: p.category?.canonical?.name ?? p.category?.name ?? null,
        precio: rango.min.toNumber(),
        desde: rango.varies,
        tieneStock: p.variants.some((v) => v.stock - v.reservedStock > 0),
        fijadoEn: p.featuredRank,
      };
    }),
  };
}

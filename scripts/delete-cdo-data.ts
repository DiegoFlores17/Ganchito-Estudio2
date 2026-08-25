/// Borra los datos de CDO de la base local, para poder re-sincronizar contra
/// produccion desde cero.
///
/// POR QUE HACE FALTA: el sync hace upsert por `cdoId`, no borra lo que ya
/// no viene. Y los `cdoId` de pruebas y de produccion NO son los mismos, asi
/// que sincronizar sin limpiar dejaria 508 productos (207 de prueba + 301
/// reales) con "Botella Prueba K3 1" mezclada en el catalogo.
///
/// Peor con las categorias: varios `cdoCategoryId` SI coinciden entre
/// entornos pero con otro nombre (221 era "Carpetas, Bolsos y Mochilas" y en
/// produccion es "Mochilas, Bolsos, Carry on"). El conector las encuentra por
/// id y les pisa el nombre, dejando categorias con identidad mezclada — justo
/// lo que arruinaria el mapeo de unificacion.
///
/// SEGURIDAD:
///   - Aborta si la base no es local.
///   - Aborta si alguna cotizacion referencia un producto de CDO. La FK de
///     QuoteItem.product es RESTRICT (sin onDelete en el schema), asi que la
///     base tambien lo frenaria — pero se chequea antes para dar un mensaje
///     util en vez de un P2003.
///   - Pide --confirmar. Sin eso, no borra nada.
///
/// Se corre: `npx tsx scripts/delete-cdo-data.ts --confirmar`
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  // El destino se verifica ACA, en el mismo proceso que escribe. No se
  // confia en un chequeo hecho antes: el .env pudo haber cambiado.
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1/.test(dbUrl)) {
    console.error(
      "ABORTADO: este script solo corre contra la base LOCAL.\n" +
        "Si de verdad hace falta limpiar produccion, es una decision aparte."
    );
    process.exit(1);
  }

  const confirmado = process.argv.includes("--confirmar");

  const productos = await prisma.product.findMany({
    where: { origin: "CDO" },
    select: { id: true },
  });
  const ids = productos.map((p) => p.id);

  const [variantes, imagenes, tecnicas, atributos, categorias] = await Promise.all([
    prisma.productVariant.count({ where: { productId: { in: ids } } }),
    prisma.productImage.count({ where: { productId: { in: ids } } }),
    prisma.productPrintingType.count({ where: { productId: { in: ids } } }),
    prisma.productAttribute.count({ where: { productId: { in: ids } } }),
    prisma.category.count({ where: { cdoCategoryId: { not: null } } }),
  ]);

  console.log("Se va a borrar de la base LOCAL:");
  console.log(`  ${productos.length} productos de CDO`);
  console.log(`  ${variantes} variantes · ${imagenes} imagenes · ${tecnicas} tecnicas · ${atributos} atributos`);
  console.log(`  ${categorias} categorias de CDO`);
  console.log("  (las variantes, imagenes, tecnicas y atributos caen solas por CASCADE)");

  // Chequeo de cotizaciones EN EL MISMO comando que el borrado, no antes.
  const itemsCdo = await prisma.quoteItem.count({
    where: { productId: { in: ids } },
  });
  if (itemsCdo > 0) {
    console.error(
      `\nABORTADO: ${itemsCdo} item(s) de cotizacion apuntan a productos de CDO.\n` +
        "Borrarlos destruiria lineas de cotizaciones historicas. Revisar a mano\n" +
        "con `npx tsx scripts/inspect-cdo-cleanup.ts` antes de seguir."
    );
    process.exit(1);
  }
  console.log(`  0 cotizaciones afectadas (verificado recien, no antes)`);

  if (!confirmado) {
    console.log("\nSimulacion: NO se borro nada.");
    console.log("Para borrar de verdad: npx tsx scripts/delete-cdo-data.ts --confirmar");
    return;
  }

  // Todo junto: si algo falla, no queda a medias.
  const resultado = await prisma.$transaction(async (tx) => {
    // Las categorias primero pasan a null en los productos que no son de CDO
    // (hoy son 0, pero el codigo no depende de eso).
    await tx.product.updateMany({
      where: {
        origin: { not: "CDO" },
        category: { cdoCategoryId: { not: null } },
      },
      data: { categoryId: null },
    });

    const prod = await tx.product.deleteMany({ where: { origin: "CDO" } });
    const cat = await tx.category.deleteMany({
      where: { cdoCategoryId: { not: null } },
    });
    return { prod: prod.count, cat: cat.count };
  });

  console.log(`\nBorrado: ${resultado.prod} productos y ${resultado.cat} categorias.`);

  const quedan = await prisma.product.groupBy({
    by: ["origin"],
    _count: { _all: true },
  });
  console.log("Quedan en la base:");
  for (const g of quedan) {
    console.log(`  ${String(g.origin).padEnd(8)} ${g._count._all}`);
  }
  console.log(`  categorias: ${await prisma.category.count()}`);
}

main()
  .catch((error) => {
    console.error("Fallo el borrado:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

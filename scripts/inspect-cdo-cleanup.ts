/// Relevamiento de lo que se borraria al limpiar los datos de CDO-PRUEBAS.
///
/// SOLO LECTURA: no ejecuta ningun delete. Es el paso previo para poder
/// revisar el alcance antes de tocar nada.
///
/// Se corre: `npx tsx scripts/inspect-cdo-cleanup.ts`
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

function titulo(t: string) {
  console.log(`\n${"=".repeat(70)}\n${t}\n${"=".repeat(70)}`);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const esLocal = /localhost|127\.0\.0\.1/.test(dbUrl);
  console.log(`Base: ${esLocal ? "LOCAL" : "NO ES LOCAL — ojo"}`);
  if (!esLocal) {
    console.error("Este relevamiento es sobre la base local. Abortando.");
    process.exit(1);
  }

  // ------------------------------------------------------------------ 1
  titulo("1. QUE SE VA");

  const productos = await prisma.product.findMany({
    where: { origin: "CDO" },
    select: { id: true, cdoId: true, name: true },
  });
  const ids = productos.map((p) => p.id);

  const [variantes, imagenes, tecnicas, atributos, areas] = await Promise.all([
    prisma.productVariant.count({ where: { productId: { in: ids } } }),
    prisma.productImage.count({ where: { productId: { in: ids } } }),
    prisma.productPrintingType.count({ where: { productId: { in: ids } } }),
    prisma.productAttribute.count({ where: { productId: { in: ids } } }),
    prisma.printingArea.count({ where: { productId: { in: ids } } }),
  ]);

  const categorias = await prisma.category.findMany({
    where: { cdoCategoryId: { not: null } },
    select: {
      id: true,
      name: true,
      cdoCategoryId: true,
      canonicalId: true,
      _count: { select: { products: true, aliases: true } },
    },
    orderBy: { name: "asc" },
  });

  console.log(`Productos CDO:        ${productos.length}`);
  console.log(`  variantes:          ${variantes}`);
  console.log(`  imagenes:           ${imagenes}`);
  console.log(`  tecnicas impresion: ${tecnicas}`);
  console.log(`  atributos:          ${atributos}`);
  console.log(`  areas de impresion: ${areas}`);
  console.log(`Categorias CDO:       ${categorias.length}`);
  for (const c of categorias) {
    const extra = [
      c._count.products ? `${c._count.products} productos` : null,
      c._count.aliases ? `${c._count.aliases} alias` : null,
      c.canonicalId ? "ES ALIAS de otra" : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`  - ${c.name} (cdoId ${c.cdoCategoryId})${extra ? ` — ${extra}` : ""}`);
  }

  // ------------------------------------------------------------------ 2
  titulo("2. QUE NO SE TOCA");

  const porOrigen = await prisma.product.groupBy({
    by: ["origin"],
    _count: { _all: true },
  });
  for (const g of porOrigen) {
    const marca = g.origin === "CDO" ? "<- se borra" : "queda";
    console.log(`  ${String(g.origin).padEnd(8)} ${String(g._count._all).padStart(5)}  ${marca}`);
  }

  const categoriasNoCdo = await prisma.category.count({
    where: { cdoCategoryId: null },
  });
  console.log(`\n  Categorias sin cdoCategoryId (Zecat + propias): ${categoriasNoCdo} — quedan`);

  // Chequeo explicito de que ningun producto de otro origen quedaria
  // apuntando a una categoria que vamos a borrar.
  const catIds = categorias.map((c) => c.id);
  const huerfanosPotenciales = await prisma.product.count({
    where: { categoryId: { in: catIds }, origin: { not: "CDO" } },
  });
  console.log(
    `  Productos NO-CDO en categorias de CDO: ${huerfanosPotenciales} ${
      huerfanosPotenciales === 0 ? "(bien, ninguno se queda sin categoria)" : "(REVISAR)"
    }`
  );

  // ------------------------------------------------------------------ 3
  titulo("3. COTIZACIONES — lo que la FK protege");

  const itemsCdo = await prisma.quoteItem.findMany({
    where: { productId: { in: ids } },
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      variantSku: true,
      product: { select: { name: true, cdoId: true } },
      quote: {
        select: { id: true, customerName: true, status: true, createdAt: true },
      },
    },
  });

  const totalCotizaciones = await prisma.quote.count();
  console.log(`Cotizaciones en la base: ${totalCotizaciones}`);
  console.log(`Items que apuntan a productos de CDO: ${itemsCdo.length}`);

  if (itemsCdo.length === 0) {
    console.log("\n  Ninguna cotizacion referencia productos de CDO.");
    console.log("  El borrado fisico no choca con la FK ON DELETE RESTRICT.");
  } else {
    console.log("\n  *** HAY COTIZACIONES APUNTANDO A PRODUCTOS DE CDO ***");
    console.log("  Un delete fisico va a fallar con P2003, a proposito.");
    for (const it of itemsCdo) {
      console.log(
        `    - cotizacion ${it.quote.id} (${it.quote.customerName}, ${it.quote.status}) ` +
          `-> "${it.product.name}" [cdoId ${it.product.cdoId}] x${it.quantity} @ ${it.unitPrice}`
      );
    }
  }

  // ------------------------------------------------------------------ 4
  titulo("4. SI SE BORRA, QUE QUEDA");

  const zecat = porOrigen.find((g) => g.origin === "ZECAT")?._count._all ?? 0;
  const manual = porOrigen.find((g) => g.origin === "MANUAL")?._count._all ?? 0;
  const otros = porOrigen
    .filter((g) => !["ZECAT", "MANUAL", "CDO"].includes(String(g.origin)))
    .reduce((n, g) => n + g._count._all, 0);

  console.log(`  Productos:   ${zecat + manual + otros} (${zecat} Zecat + ${manual} manuales${otros ? ` + ${otros} otros` : ""})`);
  console.log(`  Categorias:  ${categoriasNoCdo}`);
  console.log(`\n  Despues del sync contra produccion de CDO (+301):`);
  console.log(`  Productos:   ${zecat + manual + otros + 301}`);
}

main()
  .catch((error) => {
    console.error("Fallo el relevamiento:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

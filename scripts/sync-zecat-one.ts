import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  fetchGenericProductDetail,
  searchGenericProducts,
} from "../src/lib/zecat/client";
import { extractCostPrice } from "../src/lib/zecat/normalize";
import { syncProduct } from "../src/lib/zecat/sync";

// Script de validacion puntual: busca UN producto por nombre, muestra los
// campos de precio crudos para comparar, y corre el conector solo para ese
// producto. No toca el resto del catalogo.

const query = process.argv[2] ?? "Mochila Space Max";
const fallbackQueries = [query, "Space Max", "Space"];

async function findProduct() {
  for (const candidate of fallbackQueries) {
    console.log(`Buscando "${candidate}" en Zecat...`);
    const results = await searchGenericProducts(candidate);
    if (results.generic_products.length > 0) {
      return results.generic_products;
    }
  }
  return [];
}

async function main() {
  const matches = await findProduct();

  if (matches.length === 0) {
    console.log("No se encontro ningun producto con esos terminos de busqueda.");
    return;
  }

  console.log(
    `\nCoincidencias encontradas:\n${matches
      .map((p) => `  [${p.id}] ${p.name}`)
      .join("\n")}`
  );

  const match =
    matches.find((p) => p.name?.toLowerCase().includes("space max")) ??
    matches[0];

  console.log(`\nUsando: [${match.id}] ${match.name}`);

  const detail = await fetchGenericProductDetail(match.id);

  // Barrido crudo: cualquier campo cuyo nombre suene a precio/costo/margen,
  // sin depender de que el tipeo en types.ts haya adivinado bien los nombres.
  const rawDetail = detail as unknown as Record<string, unknown>;
  const priceLikeKeys = Object.keys(rawDetail).filter((key) =>
    /price|profit|cost|import|discount/i.test(key)
  );

  console.log("\nCampos relacionados a precio en la respuesta cruda de Zecat:");
  for (const key of priceLikeKeys) {
    console.log(`  ${key}: ${JSON.stringify(rawDetail[key])}`);
  }
  console.log(`  currency: ${JSON.stringify(rawDetail.currency)}`);

  const costPrice = extractCostPrice(detail);
  console.log(
    `\nextractCostPrice() devolvio: ${costPrice}  (leyendo el campo "price_import")`
  );

  console.log("\nCorriendo el conector para este producto unicamente...");
  const result = await syncProduct(detail);
  console.log(`Resultado del upsert: ${result}`);

  const saved = await prisma.product.findUnique({
    where: { zecatId: String(detail.id) },
    include: { variants: true, category: true },
  });

  console.log("\nProducto guardado en la base:");
  console.log(
    JSON.stringify(
      saved,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Fallo la validacion:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import "dotenv/config";
import {
  fetchGenericProductDetail,
  searchGenericProducts,
} from "../src/lib/zecat/client";

// Script de diagnostico puro: NO escribe nada en la base. Busca un producto
// por nombre, imprime sus campos de precio crudos y (si se pasa un precio
// de referencia) muestra el ratio contra cada campo para detectar cual es
// el que realmente usa la pagina actual de Ganchito.

const query = process.argv[2] ?? "Mochila Space Max";
const referencePrice = process.argv[3] ? Number(process.argv[3]) : undefined;

const PRICE_FIELDS = [
  "price",
  "unit_price",
  "total_price",
  "total_taxes",
  "total_with_taxes",
  "tax",
  "currency",
  "minimum_profit_percentage",
  "maximum_profit_percentage",
  "suggested_profit_percentage",
];

async function main() {
  console.log(`Buscando "${query}" en Zecat...`);
  const results = await searchGenericProducts(query);

  if (results.generic_products.length === 0) {
    console.log("Sin resultados.");
    return;
  }

  const match = results.generic_products[0];
  console.log(`Usando: [${match.id}] ${match.name}`);

  const detail = await fetchGenericProductDetail(match.id);
  const raw = detail as unknown as Record<string, unknown>;

  console.log("\nCampos de precio:");
  for (const field of PRICE_FIELDS) {
    console.log(`  ${field}: ${JSON.stringify(raw[field])}`);
  }

  if (referencePrice !== undefined) {
    console.log(`\nPrecio real en Ganchito (referencia): ${referencePrice}`);
    for (const field of ["price", "unit_price", "total_price", "total_with_taxes"]) {
      const value = raw[field];
      if (typeof value === "number") {
        const ratio = referencePrice / value;
        console.log(
          `  ${referencePrice} / ${field} (${value}) = ${ratio.toFixed(4)}`
        );
      }
    }
  }
}

main().catch((error) => {
  console.error("Fallo:", error);
  process.exitCode = 1;
});

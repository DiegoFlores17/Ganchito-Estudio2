import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { syncZecatCatalog } from "../src/lib/zecat/sync";

async function main() {
  console.log("Iniciando sincronizacion con Zecat...");
  const start = Date.now();

  const summary = await syncZecatCatalog();

  const elapsedSeconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\nResumen de la sincronizacion:");
  console.log(`  Total procesados: ${summary.total}`);
  console.log(`  Creados:          ${summary.created}`);
  console.log(`  Actualizados:     ${summary.updated}`);
  console.log(`  Fallidos:         ${summary.failed}`);
  console.log(`  Currency "USD":   ${summary.usdWarnings.length}`);
  console.log(`  Tiempo:           ${elapsedSeconds}s`);

  if (summary.usdWarnings.length) {
    console.log("\nProductos con currency=\"USD\" (guardados como ARS sin convertir):");
    for (const warning of summary.usdWarnings) {
      console.log(`  - [${warning.zecatId}] ${warning.name}`);
    }
  }

  if (summary.errors.length) {
    console.log("\nErrores:");
    for (const error of summary.errors) {
      console.log(`  - producto ${error.zecatId}: ${error.message}`);
    }
  }

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("La sincronizacion fallo:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

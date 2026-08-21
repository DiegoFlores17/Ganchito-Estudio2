import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { syncCdoCatalog } from "../src/lib/cdo/sync";

async function main() {
  console.log("Iniciando sincronizacion con CDO Promocionales...");
  const start = Date.now();

  const summary = await syncCdoCatalog();

  const elapsedSeconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\nResumen de la sincronizacion:");
  console.log(`  Total procesados:   ${summary.total}`);
  console.log(`  Creados:            ${summary.created}`);
  console.log(`  Actualizados:       ${summary.updated}`);
  console.log(`  Fallidos:           ${summary.failed}`);
  console.log(`  Inactivos sin foto: ${summary.sinImagen.length}`);
  console.log(`  SKU sintetico:      ${summary.skuSintetico}`);
  console.log(`  Tiempo:             ${elapsedSeconds}s`);

  if (summary.sinImagen.length) {
    console.log(
      "\nImportados INACTIVOS por no tener ninguna imagen usable (se reactivan solos si CDO les carga la foto):"
    );
    for (const p of summary.sinImagen) {
      console.log(`  - [${p.cdoId}] ${p.name}`);
    }
  }

  if (summary.iconosDesconocidos.length) {
    console.log(
      "\nIconos SIN CLASIFICAR — agregarlos a PRINTING_TECHNIQUE_ICON_IDS o ATTRIBUTE_ICON_IDS en src/lib/cdo/normalize.ts:"
    );
    for (const icon of summary.iconosDesconocidos) {
      console.log(`  - ${icon.id}: ${icon.label}`);
    }
  }

  if (summary.errors.length) {
    console.log("\nErrores:");
    for (const error of summary.errors) {
      console.log(`  - producto ${error.cdoId}: ${error.message}`);
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
  .finally(() => prisma.$disconnect());

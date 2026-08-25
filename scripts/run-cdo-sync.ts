/// Corrida del sync de CDO con su reporte, compartida por los dos
/// entrypoints: `sync:cdo` (pruebas) y `sync:cdo:prod` (produccion).
///
/// La eleccion del entorno NO vive aca: cada entrypoint deja las variables
/// que corresponden ANTES de llamar a esta funcion. Asi el destino es siempre
/// una decision explicita del comando que se corre, no un efecto secundario
/// de que variable quedo cargada en el .env.
import { prisma } from "../src/lib/prisma";
import { syncCdoCatalog } from "../src/lib/cdo/sync";

export async function runCdoSync(etiquetaEntorno: string) {
  // El destino de ESCRITURA se imprime siempre y en primer lugar. El riesgo
  // real de este script no es leer de la API equivocada: es escribir en la
  // base equivocada.
  const dbUrl = process.env.DATABASE_URL ?? "";
  const destino = /localhost|127\.0\.0\.1/.test(dbUrl)
    ? "LOCAL"
    : dbUrl.includes("neon.tech")
      ? "NEON (PRODUCCION)"
      : "DESCONOCIDO";

  console.log(`API de CDO:  ${etiquetaEntorno}`);
  console.log(`Escribe en:  ${destino}`);
  if (destino !== "LOCAL") {
    console.log(
      "\n  Ojo: no estas escribiendo en local. Si no era la intencion, cortá ahora (Ctrl+C).\n"
    );
  }

  console.log("\nIniciando sincronizacion con CDO Promocionales...");
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

  // Los dos casos de icono se listan por separado: piden acciones distintas.
  const idsNuevos = summary.iconosDesconocidos.filter((i) => i.reason === "id-nuevo");
  const labelsCambiados = summary.iconosDesconocidos.filter(
    (i) => i.reason === "label-cambiado"
  );

  if (idsNuevos.length) {
    console.log(
      "\nIconos con id NUEVO — agregarlos a PRINTING_TECHNIQUE_ICONS o ATTRIBUTE_ICONS en src/lib/cdo/normalize.ts:"
    );
    for (const icon of idsNuevos) {
      console.log(`  - ${icon.id}: "${icon.label}"`);
    }
  }

  if (labelsCambiados.length) {
    console.log(
      "\n*** ATENCION — iconos que CAMBIARON DE SIGNIFICADO ***\n" +
        "CDO reutilizo estos ids para otra cosa. NO se guardaron, a proposito.\n" +
        "Hay que revisar la clasificacion en src/lib/cdo/normalize.ts:"
    );
    for (const icon of labelsCambiados) {
      console.log(
        `  - id ${icon.id}: esperabamos "${icon.expectedLabel}" y vino "${icon.label}"`
      );
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

  return summary;
}

export async function cerrar() {
  await prisma.$disconnect();
}

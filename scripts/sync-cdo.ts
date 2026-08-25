/// Sync de CDO contra el entorno de PRUEBAS.
///
/// Usa CDO_API_URL / CDO_API_TOKEN tal como estan en el .env, que apuntan a
/// pruebas. Para produccion hay un comando aparte: `npm run sync:cdo:prod`.
import "dotenv/config";
import { runCdoSync, cerrar } from "./run-cdo-sync";

const url = process.env.CDO_API_URL ?? "(sin CDO_API_URL)";

runCdoSync(`PRUEBAS — ${url}`)
  .catch((error) => {
    console.error("La sincronizacion fallo:", error);
    process.exitCode = 1;
  })
  .finally(cerrar);

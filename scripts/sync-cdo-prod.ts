/// Sync de CDO contra el entorno de PRODUCCION.
///
/// Existe como comando aparte, y no como un flag de `sync:cdo`, por la misma
/// regla que se aplica a la base: el destino tiene que ser una decision
/// explicita del comando que se corre, no un efecto secundario de que
/// variable quedo cargada en el .env. `npm run sync:cdo` sigue apuntando a
/// pruebas pase lo que pase.
import "dotenv/config";
import { runCdoSync, cerrar } from "./run-cdo-sync";

const url = process.env.CDO_API_URL_PRODUCCION;
const token = process.env.CDO_API_TOKEN_PRODUCCION;

if (!url || !token) {
  console.error(
    "Faltan CDO_API_URL_PRODUCCION y/o CDO_API_TOKEN_PRODUCCION en el .env.\n" +
      "Van como variables APARTE de las de pruebas (CDO_API_URL / CDO_API_TOKEN)."
  );
  process.exit(1);
}

// Guarda: si la URL "de produccion" es en realidad la de pruebas, este
// comando estaria mintiendo sobre lo que hace.
if (/dev\.yellowspot|preprod|staging/i.test(url)) {
  console.error(`CDO_API_URL_PRODUCCION parece ser el entorno de PRUEBAS: ${url}`);
  process.exit(1);
}

// El cliente lee estas dos en cada request, asi que alcanza con pisarlas
// antes de arrancar.
process.env.CDO_API_URL = url;
process.env.CDO_API_TOKEN = token;

runCdoSync(`PRODUCCION — ${url}`)
  .catch((error) => {
    console.error("La sincronizacion fallo:", error);
    process.exitCode = 1;
  })
  .finally(cerrar);

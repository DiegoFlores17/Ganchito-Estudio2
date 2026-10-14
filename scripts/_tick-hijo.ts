// Proceso hijo de audit-verify-motor-c.ts: corre UN tick del motor y nada
// mas. El script padre lo mata con SIGKILL a mitad de camino para probar que
// la siguiente invocacion sigue exacto desde el cursor.
//
// Usa el entorno que le pasa el padre (DATABASE_URL de la base de prueba,
// ZECAT_API_URL del Zecat simulado). Nunca se corre a mano.
import { ProductOrigin } from "@prisma/client";
import { avanzarCorrida } from "../src/lib/sync/motor";

const base = new URL(process.env.DATABASE_URL ?? "postgres://x");
if (base.hostname !== "localhost" || !base.pathname.endsWith("_c_test")) {
  console.error("ABORTADO: el tick hijo solo corre contra la base de prueba de la etapa C.");
  process.exit(1);
}

avanzarCorrida(ProductOrigin.ZECAT, "tick-hijo", { esCron: false }).then((r) => {
  console.log(JSON.stringify(r));
  process.exit(0);
});

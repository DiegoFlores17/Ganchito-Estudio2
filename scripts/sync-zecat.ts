import "dotenv/config";
import { ProductOrigin } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { avanzarCorrida } from "../src/lib/sync/motor";
import { revisarAlertas } from "../src/lib/sync/alertas";

// Mismo motor que el cron y el boton del panel: lista congelada, ticks y el
// mismo lease. Si el cron o el panel tienen la corrida, la consola espera su
// turno y sigue la MISMA corrida (y viceversa).

/// La consola lee el .env LOCAL, que a proposito no tiene las credenciales
/// de Resend de produccion (un secreto mas dando vueltas, para un camino que
/// con el cron pasa a ser excepcional). Consecuencia: una corrida de consola
/// contra produccion NO manda alertas. Se avisa a la vista, al arrancar, en
/// vez de dejarlo implicito en un log de "Falta ALERT_EMAIL" que aparece
/// recien cuando algo ya salio mal.
function avisarSiNoHayAlertas() {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  const esLocal = host === "localhost" || host === "127.0.0.1";
  const faltan = [
    !process.env.RESEND_API_KEY && "RESEND_API_KEY",
    !process.env.ALERT_EMAIL && "ALERT_EMAIL",
  ].filter(Boolean);
  if (esLocal || faltan.length === 0) return;

  console.warn(
    "\n" +
      "==============================================================\n" +
      "  ESTA CORRIDA NO ENVÍA ALERTAS POR MAIL\n" +
      `  Base: ${host} (no es local). Falta: ${faltan.join(", ")}.\n` +
      "  Si el umbral frena el pausado o la corrida falla, solo queda\n" +
      "  en esta consola y en el historial del panel.\n" +
      "==============================================================\n"
  );
}

async function main() {
  console.log("Iniciando sincronizacion con Zecat...");
  avisarSiNoHayAlertas();
  const start = Date.now();

  // Mismo motor que el cron y el boton del panel (lib/sync/motor.ts): ticks
  // de ~45 s sobre la lista congelada, con el mismo lease. Si el cron o el
  // panel tienen la corrida en este momento, la consola espera su turno y
  // sigue la MISMA corrida: no hay dos corridas a la vez.
  let fin: Awaited<ReturnType<typeof avanzarCorrida>>;
  let siguiendo: string | null = null;
  for (;;) {
    fin = await avanzarCorrida(ProductOrigin.ZECAT, "consola", {
      esCron: false,
      siguiendo: siguiendo ?? undefined,
    });
    if (fin.estado === "ocupado") {
      console.log(`  en curso por ${fin.startedBy}: ${fin.procesados} de ${fin.total ?? "?"} — esperando el lease...`);
      siguiendo = fin.runId;
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (fin.estado === "avanzo") {
      siguiendo = fin.runId;
      console.log(`  ${fin.procesados} de ${fin.total} productos`);
      continue;
    }
    // completa o fallo (propia, o de la corrida que seguiamos y termino otro).
    break;
  }

  // Alertas por cambio de estado, igual que el cron (sin RESEND_API_KEY en
  // el .env local solo se loguean: ver avisarSiNoHayAlertas).
  await revisarAlertas(ProductOrigin.ZECAT);

  if (fin.estado === "fallo") {
    console.error(`\nCorrida FALLIDA: ${fin.mensaje}`);
    process.exitCode = 1;
    return;
  }
  if (fin.estado === "sin-corrida") {
    console.error(`\nNo se pudo tomar ninguna corrida: ${fin.motivo}`);
    process.exitCode = 1;
    return;
  }
  if (fin.estado !== "completa") return;
  const s = fin.summary;
  const done = await prisma.syncRun.findUniqueOrThrow({ where: { id: fin.runId } });
  const elapsedSeconds = ((Date.now() - start) / 1000).toFixed(1);
  const nombre = (id: string) => `${id} ${s.nombres[id] ?? ""}`.trim();

  console.log("\nResumen de la sincronizacion:");
  console.log(`  Vistos:           ${s.vistos}`);
  console.log(`  Creados:          ${s.creados}`);
  console.log(`  Actualizados:     ${s.actualizados}`);
  console.log(`  Pausados:         ${s.pausadosSinPrecio} (sin precio del proveedor)`);
  console.log(`  Fallidos:         ${s.fallidos}`);
  console.log(`  Variantes desact: ${s.variantesDesactivadas} (el proveedor dejo de mandarlas)`);
  console.log(`  Sin variantes:    ${s.productosSinVariantes} producto(s), quedan inactivos`);
  console.log(`  Currency "USD":   ${s.monedaSospechosa}`);
  console.log(`  Tiempo:           ${elapsedSeconds}s`);

  if (s.ausentes.length) {
    console.log(`\nAUSENTES: ${s.ausentes.length} producto(s) que la API ya no devuelve (umbral ${s.umbral}):`);
    for (const id of s.ausentes) {
      const estado = s.autoPausados.includes(id)
        ? " (baja confirmada, pausado)"
        : s.aRevisar.includes(id)
          ? " (A REVISAR: el detalle sigue publicado, no se pauso)"
          : s.noVerificados.includes(id)
            ? " (no se pudo verificar, no se pauso)"
            : "";
      console.log(`  - ${nombre(id)}${estado}`);
    }
    if (s.umbralFrenado) {
      console.log(
        `UMBRAL DE SEGURIDAD: ${s.ausentes.length} ausentes superan el limite de ${s.umbral} — NO se pauso ninguno. Usar "Pausar estos N" en el panel.`
      );
    }
  }
  if (s.yaPausadosFueraDeApi.length) {
    console.log(
      `Ya pausados que siguen fuera de la API: ${s.yaPausadosFueraDeApi.length} (${s.yaPausadosFueraDeApi.join(", ")})`
    );
  }

  const errors = done.errors as Array<{ externalId: string; message: string }>;
  if (errors.length) {
    console.log("\nErrores:");
    // "-" son notas de la corrida (retome, cortes) y "alerta" los avisos
    // mandados; el resto, errores de un producto.
    for (const e of errors) {
      const quien = e.externalId === "-" ? "nota" : e.externalId === "alerta" ? "alerta" : `producto ${e.externalId}`;
      console.log(`  - ${quien}: ${e.message}`);
    }
  }

  if (done.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

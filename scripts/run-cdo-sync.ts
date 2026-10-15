/// Corrida del sync de CDO con su reporte, compartida por los dos
/// entrypoints: `sync:cdo` (pruebas) y `sync:cdo:prod` (produccion).
///
/// La eleccion del entorno NO vive aca: cada entrypoint deja las variables
/// que corresponden ANTES de llamar a esta funcion. Asi el destino es siempre
/// una decision explicita del comando que se corre, no un efecto secundario
/// de que variable quedo cargada en el .env.
///
/// Desde la etapa E corre sobre el MISMO motor que el cron y el boton del
/// panel (lib/sync/motor.ts): lista congelada, ticks y el mismo lease. Si el
/// cron o el panel tienen la corrida de CDO, la consola espera su turno y
/// sigue la misma corrida.
import { ProductOrigin } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { avanzarCorrida, type ResultadoTick } from "../src/lib/sync/motor";
import { revisarAlertas } from "../src/lib/sync/alertas";
import { textoNoVerificado } from "../src/lib/sync/textos";

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

  let fin: ResultadoTick;
  let siguiendo: string | undefined;
  let tick = 0;
  for (;;) {
    const t0 = Date.now();
    fin = await avanzarCorrida(ProductOrigin.CDO, "consola", { esCron: false, siguiendo });
    tick++;
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    if (fin.estado === "ocupado") {
      console.log(`  en curso por ${fin.startedBy}: ${fin.procesados} de ${fin.total ?? "?"} — esperando el lease...`);
      siguiendo = fin.runId;
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (fin.estado === "avanzo") {
      siguiendo = fin.runId;
      console.log(`  tick ${tick} (${seg} s): ${fin.procesados} de ${fin.total} productos`);
      continue;
    }
    console.log(`  tick ${tick} (${seg} s): ${fin.estado}`);
    break;
  }

  // Alertas por cambio de estado, igual que el cron (sin RESEND_API_KEY en
  // el .env local solo se loguean).
  await revisarAlertas(ProductOrigin.CDO);

  if (fin.estado === "sin-corrida") {
    console.error(`\nNo se pudo tomar ninguna corrida: ${fin.motivo}`);
    process.exitCode = 1;
    return;
  }
  if (fin.estado === "fallo") {
    console.error(`\nCorrida FALLIDA: ${fin.mensaje}`);
    process.exitCode = 1;
    return;
  }
  if (fin.estado !== "completa") return;

  const s = fin.summary;
  const elapsedSeconds = ((Date.now() - start) / 1000).toFixed(1);
  const nombre = (id: string) => `${id} ${s.nombres[id] ?? ""}`.trim();

  console.log("\nResumen de la sincronizacion:");
  console.log(`  Vistos:             ${s.vistos} de ${s.totalRemoto}`);
  console.log(`  Creados:            ${s.creados}`);
  console.log(`  Actualizados:       ${s.actualizados}`);
  console.log(`  Fallidos:           ${s.fallidos}`);
  console.log(`  Variantes desact.:  ${s.variantesDesactivadas} (CDO dejo de mandarlas)`);
  console.log(`  Sin variantes:      ${s.productosSinVariantes} producto(s), quedan inactivos`);
  console.log(`  Apagados sin foto:  ${s.apagadosSinFoto?.length ?? 0}${s.retenidosSinFoto?.length ? ` (+ ${s.retenidosSinFoto.length} RETENIDOS: ${s.rachaSinFoto ? "sigue la racha" : "se llegó al tope"})` : ""}`);
  console.log(`  Ticks:              ${tick}`);
  console.log(`  Tiempo:             ${elapsedSeconds}s`);

  if (s.ausentes.length) {
    console.log(`\nAUSENTES: ${s.ausentes.length} producto(s) que la API ya no devuelve (umbral ${s.umbral}):`);
    for (const id of s.ausentes) {
      const estado = s.autoPausados.includes(id)
        ? " (baja confirmada, pausado)"
        : s.aRevisar.includes(id)
          ? " (A REVISAR: el detalle sigue respondiendo)"
          : s.noVerificados.includes(id)
            ? ` (${
                s.noVerificadosDetalle?.[id]
                  ? textoNoVerificado(s.noVerificadosDetalle[id].permanente, s.noVerificadosDetalle[id].motivo, "CDO")
                  : "no se pudo verificar"
              }; no se pausó)`
            : "";
      console.log(`  - ${nombre(id)}${estado}`);
    }
  }

  const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: fin.runId } });
  const errores = (run.errors as Array<{ externalId: string; message: string }>).filter(
    (e) => e.externalId !== "-" && e.externalId !== "alerta"
  );
  if (errores.length) {
    console.log("\nErrores:");
    for (const e of errores) console.log(`  - producto ${e.externalId}: ${e.message}`);
  }
  if (s.fallidos > 0) process.exitCode = 1;
}

export async function cerrar() {
  await prisma.$disconnect();
}

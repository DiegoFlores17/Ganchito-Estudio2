// Verificacion de la etapa E (CDO sobre el motor) contra la base LOCAL, con
// las APIs de PRODUCCION de CDO y de Zecat (solo GET: nada se escribe del
// lado de los proveedores). La base local tiene el catalogo real de los dos,
// asi que una corrida contra las APIs de pruebas los dejaria ausentes.
//
//   npx tsx scripts/audit-verify-cdo-e.ts
//
// Escribe en la base local: corridas de sync reales (Zecat y CDO) y prende y
// apaga el interruptor de CDO de la base LOCAL (lo deja como estaba).
import "dotenv/config";
import { ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { avanzarCorrida, type ResultadoTick } from "../src/lib/sync/motor";
import { GET } from "../src/app/api/cron/sync/[provider]/route";

// --- Guardas -------------------------------------------------------------------
const db = new URL(process.env.DATABASE_URL ?? "postgres://x");
if (db.hostname !== "localhost") {
  console.error(`ABORTADO: DATABASE_URL apunta a ${db.hostname}, no a localhost.`);
  process.exit(1);
}
const urlCdo = process.env.CDO_API_URL_PRODUCCION ?? "";
const tokenCdo = process.env.CDO_API_TOKEN_PRODUCCION ?? "";
if (!urlCdo.startsWith("https://") || /dev\.yellowspot|preprod|staging/i.test(urlCdo) || !tokenCdo) {
  console.error("ABORTADO: falta la URL de produccion de CDO (https) o su token en el .env.");
  process.exit(1);
}
process.env.CDO_API_URL = urlCdo;
process.env.CDO_API_TOKEN = tokenCdo;
const SECRET = process.env.CRON_SECRET;
if (!SECRET) {
  console.error("ABORTADO: falta CRON_SECRET en el .env local (lo necesita la ruta del cron).");
  process.exit(1);
}
// Ningun mail de verdad: sin API key, la lib solo loguea.
delete process.env.RESEND_API_KEY;

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}
const sinRepetidos = (l: string[]) => new Set(l).size === l.length;
const tickCron = async (provider: string) =>
  (await (
    await GET(new Request(`http://x/api/cron/sync/${provider}`, { headers: { authorization: `Bearer ${SECRET}` } }), {
      params: Promise.resolve({ provider }),
    })
  ).json()) as { tick?: ResultadoTick; skipped?: string };

async function correrHastaTerminar(provider: ProductOrigin, startedBy: string) {
  const t0 = Date.now();
  let siguiendo: string | undefined;
  for (let i = 0; i < 500; i++) {
    const r = await avanzarCorrida(provider, startedBy, { esCron: false, siguiendo });
    if ("runId" in r) siguiendo = r.runId;
    if (r.estado === "completa" || r.estado === "fallo") return { r, seg: (Date.now() - t0) / 1000 };
    if (r.estado === "ocupado") await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error("demasiados ticks");
}

async function main() {
  const abiertas = await prisma.syncRun.count({ where: { status: SyncRunStatus.RUNNING } });
  if (abiertas) throw new Error(`Hay ${abiertas} corrida(s) RUNNING en la base local: no se corre.`);
  const cdoAntes = await prisma.supplier.findUnique({ where: { origin: ProductOrigin.CDO } });

  try {
    console.log("=========== PANEL Y CRON INTERCALADOS SOBRE UNA CORRIDA DE CDO ===========");
    await prisma.supplier.upsert({
      where: { origin: ProductOrigin.CDO },
      update: { autoSyncEnabled: true },
      create: { origin: ProductOrigin.CDO, name: "CDO Promocionales", autoSyncEnabled: true },
    });
    // Ticks MUY cortos: con la cache de imagenes cargada, CDO hace ~10 ms por
    // producto en local, y con 4 s el cron se llevaba la corrida entera en un
    // solo turno (medido): sin turnos de los dos no se prueba nada.
    process.env.SYNC_TICK_BUDGET_MS = "300";
    const primero = await avanzarCorrida(ProductOrigin.CDO, "admin@ejemplo.test", { esCron: false });
    check("el panel arranca una corrida de CDO", primero.estado === "avanzo", primero.estado);
    const runId = "runId" in primero ? primero.runId : "";
    const turnos = { panel: 0, cron: 0 };
    let ultimo = primero.estado as string;
    for (let i = 0; i < 400 && ultimo !== "completa" && ultimo !== "fallo"; i++) {
      if (i % 2 === 0) {
        const t = (await tickCron("cdo")).tick!;
        ultimo = t.estado;
        turnos.cron++;
        if ("runId" in t) check("cron sobre la MISMA corrida", t.runId === runId);
      } else {
        const r = await avanzarCorrida(ProductOrigin.CDO, "admin@ejemplo.test", { esCron: false, siguiendo: runId });
        ultimo = r.estado;
        turnos.panel++;
        if ("runId" in r) check("panel sobre la MISMA corrida", r.runId === runId);
      }
    }
    const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId } });
    const vistos = run.seenExternalIds as string[];
    check("intercalados: termina DONE", run.status === SyncRunStatus.DONE, run.status);
    check("intercalados: vistos = total declarado, sin repetidos", vistos.length === run.totalRemote && sinRepetidos(vistos), `${vistos.length}/${run.totalRemote}`);
    check("intercalados: startedBy = quien la empezo (panel)", run.startedBy === "admin@ejemplo.test");
    check("intercalados: hubo turnos de los dos", turnos.cron > 1 && turnos.panel > 1, JSON.stringify(turnos));
    check("intercalados: lease liberado", run.leaseUntil === null);

    console.log("\n=========== ZECAT Y CDO EN PARALELO ===========");
    delete process.env.SYNC_TICK_BUDGET_MS; // presupuesto real: 45 s
    const [z, c] = await Promise.all([
      correrHastaTerminar(ProductOrigin.ZECAT, "consola"),
      correrHastaTerminar(ProductOrigin.CDO, "consola"),
    ]);
    check("Zecat termina bien en paralelo", z.r.estado === "completa", `${z.r.estado} en ${z.seg.toFixed(0)} s`);
    check("CDO termina bien en paralelo", c.r.estado === "completa", `${c.r.estado} en ${c.seg.toFixed(0)} s`);
    const rz = await prisma.syncRun.findUniqueOrThrow({ where: { id: z.r.runId } });
    const rc = await prisma.syncRun.findUniqueOrThrow({ where: { id: c.r.runId } });
    const vz = rz.seenExternalIds as string[];
    const vc = rc.seenExternalIds as string[];
    check("dos corridas distintas, una por proveedor", rz.id !== rc.id && rz.provider === ProductOrigin.ZECAT && rc.provider === ProductOrigin.CDO);
    check("Zecat: vistos = total, sin repetidos", vz.length === rz.totalRemote && sinRepetidos(vz), `${vz.length}/${rz.totalRemote}`);
    check("CDO: vistos = total, sin repetidos", vc.length === rc.totalRemote && sinRepetidos(vc), `${vc.length}/${rc.totalRemote}`);
    const cruzados = await prisma.product.count({
      where: { OR: [{ origin: ProductOrigin.ZECAT, cdoId: { not: null } }, { origin: ProductOrigin.CDO, zecatId: { not: null } }] },
    });
    check("ningun producto cruzado entre proveedores", cruzados === 0);
  } finally {
    // El interruptor de CDO de la base local vuelve a como estaba.
    await prisma.supplier.update({
      where: { origin: ProductOrigin.CDO },
      data: { autoSyncEnabled: cdoAntes?.autoSyncEnabled ?? false },
    });
  }
}

main()
  .catch((e) => {
    fallos++;
    console.error("TIRO:", e);
  })
  .finally(async () => {
    console.log(fallos ? `\n${fallos} chequeo(s) fallaron.` : "\nTodos los chequeos pasan.");
    process.exitCode = fallos ? 1 : 0;
    await prisma.$disconnect();
  });

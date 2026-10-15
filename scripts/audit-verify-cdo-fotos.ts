// Verificacion de las fotos de CDO con la CDN caida (etapa E, F3): una
// medicion sin respuesta definitiva (timeout, 5xx, red) NO apaga productos.
//
//   npx tsx scripts/audit-verify-cdo-fotos.ts
//
// Corre contra la base LOCAL y la API de PRODUCCION de CDO (solo GET). La CDN
// de imagenes se simula: el fetch a *.cloudfront.net no sale a la red.
//
// Necesita la cache de imagenes VACIA, asi que la respalda en
// image_probes_respaldo, la vacia, y la restaura al final. Si el script
// muere en el medio, el respaldo queda y la proxima ejecucion se niega a
// correr hasta restaurarlo a mano (no lo pisa).
import "dotenv/config";
import { ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { avanzarCorrida } from "../src/lib/sync/motor";
import { umbralDeSeguridad } from "../src/lib/sync-run";
import { armarAlerta } from "../src/lib/email";
import { conectorDe } from "../src/lib/sync/conectores";
import { listarCatalogoCompleto } from "../src/lib/cdo/client";
import type { CdoProduct } from "../src/lib/cdo/types";

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
delete process.env.RESEND_API_KEY; // ningun mail de verdad

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

// --- CDN simulada ----------------------------------------------------------------
/// "caida": timeout, 503 y error de red, rotando (nada definitivo).
/// "403": responde que no existe a TODO (un cambio de permisos en masa).
type ModoCdn = "real" | "caida" | "403";
let modoCdn: ModoCdn = "real";
let pedidosCdn = 0;
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (modoCdn !== "real" && new URL(url).hostname.endsWith(".cloudfront.net")) {
    pedidosCdn++;
    if (modoCdn === "403") {
      return new Response("<Error><Code>AccessDenied</Code></Error>", {
        status: 403,
        headers: { "content-type": "application/xml" },
      });
    }
    switch (pedidosCdn % 3) {
      case 0:
        throw new TypeError("fetch failed");
      case 1:
        return new Response("Service Unavailable", { status: 503 });
      default:
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
  }
  return fetchReal(input, init);
}) as typeof fetch;

const estadoCdo = async () =>
  new Map(
    (
      await prisma.product.findMany({
        where: { origin: ProductOrigin.CDO, deletedAt: null },
        select: { cdoId: true, active: true },
      })
    ).map((p) => [p.cdoId!, p.active])
  );
const imagenesCdo = () => prisma.productImage.count({ where: { product: { origin: ProductOrigin.CDO } } });
const urlsCdo = async () =>
  new Set(
    (await prisma.productImage.findMany({ where: { product: { origin: ProductOrigin.CDO } }, select: { url: true } })).map((i) => i.url)
  );
const imagenesDe = (cdoIds: string[]) =>
  prisma.productImage.count({ where: { product: { origin: ProductOrigin.CDO, cdoId: { in: cdoIds } } } });

async function corridaEntera(modo: ModoCdn) {
  modoCdn = modo;
  try {
    let siguiendo: string | undefined;
    for (let i = 0; i < 200; i++) {
      const r = await avanzarCorrida(ProductOrigin.CDO, "consola", { esCron: false, siguiendo });
      if ("runId" in r) siguiendo = r.runId;
      if (r.estado === "completa" || r.estado === "fallo" || r.estado === "sin-corrida") return r;
    }
    throw new Error("demasiados ticks");
  } finally {
    modoCdn = "real";
  }
}

const ID_NUEVO = 99999902;

async function main() {
  const [{ existe }] = await prisma.$queryRaw<Array<{ existe: boolean }>>`
    SELECT to_regclass('image_probes_respaldo') IS NOT NULL AS existe`;
  if (existe) {
    throw new Error(
      "Ya existe image_probes_respaldo (una ejecucion anterior murio en el medio). Restaurala a mano antes de volver a correr."
    );
  }
  const abiertas = await prisma.syncRun.count({ where: { status: SyncRunStatus.RUNNING } });
  if (abiertas) throw new Error(`Hay ${abiertas} corrida(s) RUNNING en la base local: no se corre.`);

  await prisma.$executeRaw`CREATE TABLE image_probes_respaldo AS SELECT * FROM image_probes`;
  const respaldadas = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM image_probes_respaldo`;
  console.log(`Cache respaldada: ${respaldadas[0].n} mediciones.`);
  const conector = conectorDe(ProductOrigin.CDO)!;
  const inicial = await estadoCdo();
  const imagenesInicial = await imagenesCdo();
  const urlsInicial = await urlsCdo();
  const chicasRespaldo = new Set(
    (await prisma.$queryRaw<Array<{ url: string }>>`SELECT url FROM image_probes_respaldo WHERE verdict = 'chica'`).map((r) => r.url)
  );

  try {
    await prisma.$executeRaw`TRUNCATE image_probes`;

    console.log("\n=========== CORRIDA ENTERA CON LA CDN CAIDA Y LA CACHE VACIA ===========");
    const fin1 = await corridaEntera("caida");
    check("la corrida termina DONE", fin1.estado === "completa", fin1.estado);
    check("la CDN simulada recibio pedidos", pedidosCdn > 0, `${pedidosCdn}`);
    const despues1 = await estadoCdo();
    const apagados1 = [...inicial].filter(([id, a]) => a && despues1.get(id) === false).map(([id]) => id);
    const prendidos1 = [...inicial].filter(([id, a]) => !a && despues1.get(id) === true).map(([id]) => id);
    check("NINGUN producto se apaga", apagados1.length === 0, apagados1.length ? apagados1.slice(0, 10).join(", ") : `${[...inicial.values()].filter(Boolean).length} activos siguen activos`);
    check("ningun inactivo se prende sin foto medida", prendidos1.length === 0, prendidos1.slice(0, 10).join(", "));
    check("nada se guarda en la cache (ni como rota)", (await prisma.imageProbe.count()) === 0);
    // Sin medir no se descarta nada: con la cache VACIA (solo en esta
    // prueba) entran tambien las que la cache tenia como "chica". En
    // produccion la cache tiene su veredicto y se usa ese.
    const urls1 = await urlsCdo();
    const perdidas = [...urlsInicial].filter((u) => !urls1.has(u));
    const extras = [...urls1].filter((u) => !urlsInicial.has(u));
    check("no se pierde ninguna imagen del catalogo", perdidas.length === 0, `${perdidas.length} perdidas`);
    check("las de mas son SOLO las que la cache tenia como chicas", extras.every((u) => chicasRespaldo.has(u)), `${extras.length} de mas, ${extras.filter((u) => chicasRespaldo.has(u)).length} eran chicas`);
    const s1 = fin1.estado === "completa" ? fin1.summary : null;
    check("resumen: 0 apagados y 0 retenidos por foto", s1?.apagadosSinFoto?.length === 0 && s1?.retenidosSinFoto?.length === 0);

    console.log("\n=========== PRODUCTO NUEVO CON LA CDN CAIDA ===========");
    const { productos } = await listarCatalogoCompleto();
    const molde = productos.find((p) => inicial.get(String(p.id)) === true)!;
    const nuevo: CdoProduct = {
      ...molde,
      id: ID_NUEVO,
      code: `PRUEBA-${ID_NUEVO}`,
      variants: (molde.variants ?? []).map((v, i) => ({ ...v, id: ID_NUEVO * 10 + i })),
    };
    modoCdn = "caida";
    await conector.sincronizar(nuevo, { puedeApagarSinFoto: true });
    modoCdn = "real";
    const creado = await prisma.product.findUnique({ where: { cdoId: String(ID_NUEVO) } });
    check("un producto NUEVO sin foto medible entra inactivo", creado?.active === false, `active=${creado?.active}`);
    await prisma.product.deleteMany({ where: { cdoId: String(ID_NUEVO) } });

    console.log("\n=========== 403 EN TODA LA CDN: EL TOPE ===========");
    const { umbral } = await umbralDeSeguridad(ProductOrigin.CDO);
    const antes2 = await estadoCdo();
    const fin2 = await corridaEntera("403");
    check("la corrida termina DONE", fin2.estado === "completa", fin2.estado);
    const s2 = fin2.estado === "completa" ? fin2.summary : null;
    // Los ausentes (activos en local que la API ya no manda) no se
    // sincronizan: no pueden apagarse ni retenerse por foto.
    const ausentes2 = new Set(s2?.ausentes ?? []);
    const activos2 = [...antes2].filter(([id, a]) => a && !ausentes2.has(id)).map(([id]) => id);
    console.log(`  ausentes que no entran en la cuenta: ${[...ausentes2].join(", ") || "ninguno"}`);
    const apagados2 = s2?.apagadosSinFoto ?? [];
    const retenidos2 = s2?.retenidosSinFoto ?? [];
    check(`se apagan EXACTAMENTE umbral (${umbral}) productos`, apagados2.length === umbral, `${apagados2.length}`);
    check("el resto de los activos queda retenido", retenidos2.length === activos2.length - umbral, `${retenidos2.length} de ${activos2.length - umbral}`);
    const despues2 = await estadoCdo();
    check("los apagados estan inactivos en la base", apagados2.every((id) => despues2.get(id) === false));
    check("los retenidos siguen activos", retenidos2.every((id) => despues2.get(id) === true));
    const conImagenes = await imagenesDe(retenidos2);
    const sinFotoRetenidos = await prisma.product.count({
      where: { origin: ProductOrigin.CDO, cdoId: { in: retenidos2 }, images: { none: {} } },
    });
    check("los retenidos conservan sus imagenes", sinFotoRetenidos === 0, `${conImagenes} imagenes, ${sinFotoRetenidos} retenidos sin ninguna`);
    const rotas = await prisma.imageProbe.count({ where: { verdict: "rota" } });
    check("las 403 se guardan como rota", rotas > 0, `${rotas}`);

    check("la corrida 1 marca el tope (y no esta en racha)", s2?.topeSinFoto === true && s2?.rachaSinFoto === false);

    console.log("\n=========== RETENIDO CON SUS FOTOS COMO ROTA, Y LA CDN LENTA ===========");
    // A nivel producto y SIN tope (puedeApagarSinFoto: true): en una corrida
    // entera la racha bloquearia todo y no se probaria nada. Sus fotos quedaron
    // "rota" en la cache: la CDN lenta no es evidencia nueva y no puede apagarlo.
    const idRetenido = retenidos2[0];
    const pRetenido = productos.find((p) => String(p.id) === idRetenido)!;
    const imagenesRetenido = await imagenesDe([idRetenido]);
    modoCdn = "caida";
    const rr = await conector.sincronizar(pRetenido, { puedeApagarSinFoto: true });
    modoCdn = "real";
    const retenidoDespues = await prisma.product.findUnique({ where: { cdoId: idRetenido } });
    check("con la rota VIEJA y la CDN lenta, sigue activo", retenidoDespues?.active === true && rr.sinFoto === undefined, `active=${retenidoDespues?.active} sinFoto=${rr.sinFoto}`);
    check("y conserva sus imagenes", (await imagenesDe([idRetenido])) === imagenesRetenido, `${imagenesRetenido}`);

    console.log("\n=========== SEGUNDA CORRIDA SEGUIDA CON 403: LA RACHA ===========");
    const antes5 = await estadoCdo();
    const fin5 = await corridaEntera("403");
    check("la corrida termina DONE", fin5.estado === "completa", fin5.estado);
    const s5 = fin5.estado === "completa" ? fin5.summary : null;
    const despues5 = await estadoCdo();
    const cambiados5 = [...antes5].filter(([id, a]) => despues5.get(id) !== a).map(([id]) => id);
    check("la segunda NO apaga ninguno", (s5?.apagadosSinFoto?.length ?? -1) === 0 && cambiados5.length === 0, `apagados=${s5?.apagadosSinFoto?.length} cambiados=${cambiados5.length}`);
    check("todos los que se habrian apagado quedan retenidos", s5?.retenidosSinFoto?.length === retenidos2.length, `${s5?.retenidosSinFoto?.length} de ${retenidos2.length}`);
    check("los retenidos conservan sus imagenes", (await prisma.product.count({ where: { origin: ProductOrigin.CDO, cdoId: { in: s5?.retenidosSinFoto ?? [] }, images: { none: {} } } })) === 0);
    check("el resumen dice racha y tope", s5?.rachaSinFoto === true && s5?.topeSinFoto === true);
    const mail = armarAlerta({
      motivo: "sin-foto",
      provider: "CDO",
      runId: "x",
      racha: true,
      umbral: s5?.umbral ?? 0,
      apagados: [],
      retenidos: [{ externalId: "1", nombre: "Uno", stockDisponible: null }],
    });
    check("la alerta dice que la racha sigue", /sigue la racha/i.test(mail.titulo) && /La racha sigue/.test(mail.cuerpo), mail.titulo);

    console.log("\n=========== CDN SANA OTRA VEZ: TODO VUELVE ===========");
    // Se restaura la cache (las rotas de recien se vuelven a medir igual).
    await prisma.$executeRaw`TRUNCATE image_probes`;
    await prisma.$executeRaw`INSERT INTO image_probes SELECT * FROM image_probes_respaldo`;
    const fin3 = await corridaEntera("real");
    check("la corrida sana termina DONE", fin3.estado === "completa", fin3.estado);
    const final = await estadoCdo();
    const distintos = [...inicial].filter(([id, a]) => final.get(id) !== a).map(([id]) => id);
    check("el estado de TODOS los productos vuelve al inicial", distintos.length === 0, distintos.slice(0, 10).join(", "));
    const imagenesFinal = await imagenesCdo();
    check("las imagenes vuelven al total inicial", imagenesFinal === imagenesInicial, `${imagenesInicial} -> ${imagenesFinal}`);
    const s3 = fin3.estado === "completa" ? fin3.summary : null;
    check("la corrida sana corta la racha (sin tope)", s3?.topeSinFoto === false && s3?.apagadosSinFoto?.length === 0, `tope=${s3?.topeSinFoto} racha=${s3?.rachaSinFoto}`);
  } finally {
    modoCdn = "real";
    await prisma.product.deleteMany({ where: { cdoId: String(ID_NUEVO) } });
    await prisma.$executeRaw`TRUNCATE image_probes`;
    await prisma.$executeRaw`INSERT INTO image_probes SELECT * FROM image_probes_respaldo`;
    const restauradas = await prisma.imageProbe.count();
    if (BigInt(restauradas) === respaldadas[0].n) {
      await prisma.$executeRaw`DROP TABLE image_probes_respaldo`;
      console.log(`\nCache restaurada: ${restauradas} mediciones.`);
    } else {
      fallos++;
      console.error(`\nLa cache restaurada tiene ${restauradas} y el respaldo ${respaldadas[0].n}: queda image_probes_respaldo para revisar.`);
    }
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

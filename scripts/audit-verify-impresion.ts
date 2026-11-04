// Verificacion de la tanda 4a (DATOS de personalizacion de Zecat): niveles de
// impresion (ProductPrintingLevel) y recargo bajo el minimo.
//
// Corre contra la base de PRUEBA *_c_test del Postgres local (la parte de
// base y la del motor borran lo que haya), con Zecat simulado
// (scripts/_zecat-falso.ts) y Resend interceptado: ningun request sale de la
// maquina.
//
//   DATABASE_URL=postgresql://…@localhost:5432/ganchito_estudio_c_test \
//     npx tsx scripts/audit-verify-impresion.ts
//
// Tres partes:
//   1. Normalizacion/validacion PURA sobre los payloads reales guardados.
//   2. syncProduct contra la base: escritura, hash, casos rotos, retencion.
//   3. El motor entero: la guarda por corrida ("tope por racha").
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ProductOrigin, SyncRunStatus } from "@prisma/client";

// --- Guarda: SOLO la base de prueba ------------------------------------------
const db = new URL(process.env.DATABASE_URL ?? "postgres://x");
if (db.hostname !== "localhost" || !db.pathname.endsWith("_c_test")) {
  console.error(`ABORTADO: este script solo corre contra la base *_c_test en localhost (vino ${db.hostname}${db.pathname}).`);
  process.exit(1);
}
process.env.RESEND_API_KEY = "re_FALSA_solo_para_este_script";
process.env.ALERT_EMAIL = "alertas@ejemplo.test";
process.env.ZECAT_API_TOKEN = "falso";

const PAYLOADS =
  process.env.PAYLOADS_DIR ??
  "/private/tmp/claude-501/-Users-diego-Downloads-ganchito-estudio/b8a6388d-0918-4316-ab46-62ec863e6346/scratchpad";

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

// --- Resend interceptado -------------------------------------------------------
const mails: Array<{ asunto: string; html: string }> = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.resend.com")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    mails.push({ asunto: body.subject, html: body.html });
    return Response.json({ id: `mail-${mails.length}` });
  }
  if (!url.startsWith("http://127.0.0.1")) throw new Error(`Request inesperado a ${url}`);
  return fetchOriginal(input, init);
}) as typeof fetch;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Detalle = any;

function cargar(id: string): Detalle {
  const crudo = JSON.parse(fs.readFileSync(path.join(PAYLOADS, `zp-${id}.json`), "utf8"));
  return crudo.generic_product ?? crudo;
}

/// Copia de un payload real con otro id y skus propios (el sku de variante es
/// unico global: dos copias sin esto se robarian las variantes).
function clonar(base: Detalle, id: string): Detalle {
  const d = structuredClone(base);
  d.id = id;
  for (const grupo of [d.variants?.colors, d.variants?.sizes]) {
    for (const lista of Object.values(grupo ?? {}) as Array<Array<{ sku: string }>>) {
      for (const v of lista) v.sku = `${v.sku}-${id}`;
    }
  }
  return d;
}

async function main() {
  const { normalizarImpresion } = await import("../src/lib/zecat/impresion");
  const { decidirNiveles, topeNiveles } = await import("../src/lib/sync/niveles");
  const { calcularPublicHash } = await import("../src/lib/sync/cambios");
  const { prisma } = await import("../src/lib/prisma");
  const { syncProduct } = await import("../src/lib/zecat/sync");

  // =========================== 1. NORMALIZACION PURA ===========================
  console.log("=========== 1. Normalizacion sobre los payloads reales ===========");
  const p5515 = cargar("5515");
  const r5515 = normalizarImpresion(p5515);
  if (r5515.tipo !== "ok") throw new Error("5515 deberia ser valido");
  check("5515: 16 niveles (uno por fila de printing_types)", r5515.niveles.length === 16, String(r5515.niveles.length));
  const b2 = r5515.niveles.find((n) => n.label === "Bordado 2KP");
  check("5515 Bordado 2KP: unitCost 877.40 (unit_price, NO el wepod)", b2?.unitCost === 877.4, String(b2?.unitCost));
  check("5515 Bordado 2KP: setupCost 46600", b2?.setupCost === 46600, String(b2?.setupCost));
  check("5515 Bordado 2KP: tecnica 'Bordado', areaCm2 10, zecatTypeId '11'", b2?.technique === "Bordado" && b2?.areaCm2 === 10 && b2?.zecatTypeId === "11");
  const b4 = r5515.niveles.find((n) => n.zecatTypeId === "12");
  check("el label sale RECORTADO ('Bordado 4KP ' -> 'Bordado 4KP')", b4?.label === "Bordado 4KP", JSON.stringify(b4?.label));
  check("5515 Bordado: zecatAreaIds = ['3519'] (strings)", JSON.stringify(b2?.zecatAreaIds) === JSON.stringify(["3519"]));
  const dtf5515 = r5515.niveles.find((n) => n.label === "Transfer DTF 900 cm2");
  check(
    "5515 DTF 900: areas ['3519','3521','3522','4204']",
    JSON.stringify(dtf5515?.zecatAreaIds) === JSON.stringify(["3519", "3521", "3522", "4204"]),
    JSON.stringify(dtf5515?.zecatAreaIds)
  );
  check("5515: recargo 95000", r5515.recargo === 95000, String(r5515.recargo));

  const r3965 = normalizarImpresion(cargar("3965"));
  if (r3965.tipo !== "ok") throw new Error("3965 deberia ser valido");
  const d900 = r3965.niveles.find((n) => n.label === "Transfer DTF 900 cm2");
  check("3965 Transfer DTF 900 cm2: setupCost 25500", d900?.setupCost === 25500, String(d900?.setupCost));
  check("3965 DTF 900: areaCm2 1100 (el area del nivel, no el 900 del nombre)", d900?.areaCm2 === 1100, String(d900?.areaCm2));
  const d25 = r3965.niveles.find((n) => n.label === "Transfer DTF 25 cm2");
  check("3965: el setup NO es constante en la tecnica (DTF 25 = 12400)", d25?.setupCost === 12400, String(d25?.setupCost));
  check("3965: 7 niveles y recargo 95000", r3965.niveles.length === 7 && r3965.recargo === 95000);

  const r5257 = normalizarImpresion(cargar("5257"));
  if (r5257.tipo !== "ok") throw new Error("5257 deberia ser valido");
  const dtp = r5257.niveles.filter((n) => n.technique === "DTP Full Color");
  check("5257: DTP Full Color sin ningun area -> zecatAreaIds [] (no es 'roto')", dtp.length === 3 && dtp.every((n) => n.zecatAreaIds.length === 0));
  check("5257: Serigrafia Plana y Laser Rotativo CO2 tambien sin area", r5257.niveles.filter((n) => ["Serigrafia Plana", "Laser Rotativo CO2"].includes(n.technique)).every((n) => n.zecatAreaIds.length === 0));
  check("5257: 13 niveles", r5257.niveles.length === 13);

  for (const id of ["3970", "3994", "4023", "4048", "4051", "4711", "5224"]) {
    const r = normalizarImpresion(cargar(id));
    const esperados = cargar(id).printing_types.length;
    check(`${id}: valido y con ${esperados} niveles`, r.tipo === "ok" && r.niveles.length === esperados);
  }
  const r3970 = normalizarImpresion(cargar("3970"));
  check(
    "3970: cuatro areas en un nivel",
    r3970.tipo === "ok" && JSON.stringify(r3970.niveles[0].zecatAreaIds) === JSON.stringify(["1726", "1097", "38", "1725"])
  );

  console.log("\n=========== 1b. Casos rotos sinteticos (cada regla -> roto) ===========");
  const roto = (mut: (d: Detalle) => void) => {
    const d = structuredClone(p5515);
    mut(d);
    return normalizarImpresion(d);
  };
  const casos: Array<[string, (d: Detalle) => void]> = [
    ["falta el id de un nivel", (d) => delete d.printing_types[0].id],
    ["id nulo", (d) => (d.printing_types[0].id = null)],
    ["falta el name", (d) => delete d.printing_types[2].name],
    ["name en blanco", (d) => (d.printing_types[2].name = "   ")],
    ["unit_price no numerico ('abc')", (d) => (d.printing_types[1].unit_price = "abc")],
    ["unit_price negativo", (d) => (d.printing_types[1].unit_price = -1)],
    ["unit_price Infinity", (d) => (d.printing_types[1].unit_price = Infinity)],
    ["unit_price NaN", (d) => (d.printing_types[1].unit_price = NaN)],
    ["unit_price null", (d) => (d.printing_types[1].unit_price = null)],
    ["setup_price ausente", (d) => delete d.printing_types[3].setup_price],
    ["setup_price negativo", (d) => (d.printing_types[3].setup_price = -0.01)],
    ["zecatTypeId duplicado", (d) => (d.printing_types[5].id = d.printing_types[0].id)],
    ["first_logo_free: true", (d) => (d.printing_types[4].first_logo_free = true)],
    ["setup_free: true", (d) => (d.printing_types[4].setup_free = true)],
    ["recargo no numerico ('mucho')", (d) => (d.customization_under_minimum_extra_cost = "mucho")],
    ["recargo NaN", (d) => (d.customization_under_minimum_extra_cost = NaN)],
  ];
  for (const [nombre, mut] of casos) {
    const r = roto(mut);
    check(`roto: ${nombre}`, r.tipo === "roto" && r.motivos.length > 0, r.tipo === "roto" ? r.motivos.join(" | ") : "salio ok");
  }
  const sinRecargo = roto((d) => delete d.customization_under_minimum_extra_cost);
  check("recargo AUSENTE no es roto: queda null", sinRecargo.tipo === "ok" && sinRecargo.recargo === null);
  const recargoString = roto((d) => (d.customization_under_minimum_extra_cost = "95000"));
  check("recargo '95000' (string numerico) es valido", recargoString.tipo === "ok" && recargoString.recargo === 95000);
  const sinTipos = roto((d) => delete d.printing_types);
  check("sin printing_types: ok con 0 niveles (ausente, no roto)", sinTipos.tipo === "ok" && sinTipos.niveles.length === 0);
  const vacio = roto((d) => (d.printing_types = []));
  check("printing_types []: ok con 0 niveles", vacio.tipo === "ok" && vacio.niveles.length === 0);
  const sinDesc = roto((d) => delete d.printing_types[0].description);
  check("description ausente: el label cae al name (no es roto)", sinDesc.tipo === "ok" && sinDesc.niveles[0].label === "Bordado");
  const sinArea = roto((d) => (d.printing_types[0].area = null));
  check("area null: areaCm2 null (no es roto)", sinArea.tipo === "ok" && sinArea.niveles[0].areaCm2 === null);
  check("el payload original NO se muto", normalizarImpresion(p5515).tipo === "ok");

  console.log("\n=========== 1c. Guarda por producto y por corrida (funciones puras) ===========");
  check("tenia 16 y vienen 0 con cupo -> pierde y se aplica", JSON.stringify(decidirNiveles({ tenia: 16, nuevos: 0, puedeQuitar: true })) === JSON.stringify({ perdia: true, retenido: false }));
  check("tenia 16 y vienen 0 sin cupo -> pierde y se RETIENE", JSON.stringify(decidirNiveles({ tenia: 16, nuevos: 0, puedeQuitar: false })) === JSON.stringify({ perdia: true, retenido: true }));
  check("tenia 0 y vienen 0 -> no pierde nada, nunca se retiene", JSON.stringify(decidirNiveles({ tenia: 0, nuevos: 0, puedeQuitar: false })) === JSON.stringify({ perdia: false, retenido: false }));
  check("tenia 16 y vienen 9 -> no es perdida total (se aplica el cambio)", JSON.stringify(decidirNiveles({ tenia: 16, nuevos: 9, puedeQuitar: false })) === JSON.stringify({ perdia: false, retenido: false }));
  check("tope sin racha: hay retenidos -> se llego", topeNiveles({ retenidos: 1, umbral: 10, racha: false }) === true);
  check("tope sin racha: 0 retenidos -> no", topeNiveles({ retenidos: 0, umbral: 10, racha: false }) === false);
  check("tope con racha: retenidos <= umbral -> la racha se corta", topeNiveles({ retenidos: 10, umbral: 10, racha: true }) === false);
  check("tope con racha: retenidos > umbral -> sigue", topeNiveles({ retenidos: 11, umbral: 10, racha: true }) === true);

  console.log("\n=========== 1d. publicHash: CDO no cambia, Zecat si ===========");
  const cdoBase = {
    name: "Taza CDO", description: "x", currency: "USD", minOrderQuantity: null,
    heightCm: 9, widthCm: "8.50", lengthCm: null, weightG: 300, active: true, categoryId: "c1",
    variantes: [{ sku: "cdo-1-a", colorName: "Rojo", colorHex: null, sizeName: null, materialName: null, costPrice: 194.97, discountPercent: null, discountTiers: null, active: true }],
    imagenes: [{ url: "https://x/y.jpg", isMain: true, sortOrder: 0, variantSku: null }],
    areasImpresion: [], tiposImpresion: [{ name: "Serigrafia" }], atributos: [{ externalId: "9", name: "RECICLABLE", iconUrl: null }],
  };
  // Hash calculado con la funcion ANTERIOR a este cambio (2026-11-04).
  const HASH_CDO_DE_ANTES = "ba9bcd28440f20389333b16e784f336cd27dc727ab241ec9b18e5186bdf5ad8e";
  check("CDO (sin los campos nuevos): el hash es BYTE A BYTE el de antes", calcularPublicHash(cdoBase) === HASH_CDO_DE_ANTES);
  check(
    "CDO con las claves nuevas en undefined: mismo hash (canonico las descarta)",
    calcularPublicHash({ ...cdoBase, nivelesImpresion: undefined, printingUnderMinimumCost: undefined }) === HASH_CDO_DE_ANTES
  );
  const nivel = { zecatTypeId: "11", technique: "Bordado", label: "Bordado 2KP", areaCm2: 10, unitCost: 877.4, setupCost: 46600, zecatAreaIds: ["3519"] };
  const hZecat = calcularPublicHash({ ...cdoBase, nivelesImpresion: [nivel], printingUnderMinimumCost: 95000 });
  check("Zecat con niveles: el hash cambia respecto del de antes (invalidacion unica)", hZecat !== HASH_CDO_DE_ANTES);
  check("Zecat sin niveles (array vacio) tambien cambia respecto de 'sin el campo'", calcularPublicHash({ ...cdoBase, nivelesImpresion: [], printingUnderMinimumCost: null }) !== HASH_CDO_DE_ANTES);
  check("cambiar el unitCost cambia el hash", calcularPublicHash({ ...cdoBase, nivelesImpresion: [{ ...nivel, unitCost: 900 }], printingUnderMinimumCost: 95000 }) !== hZecat);
  check("cambiar el setupCost cambia el hash", calcularPublicHash({ ...cdoBase, nivelesImpresion: [{ ...nivel, setupCost: 1 }], printingUnderMinimumCost: 95000 }) !== hZecat);
  check("cambiar el recargo cambia el hash", calcularPublicHash({ ...cdoBase, nivelesImpresion: [nivel], printingUnderMinimumCost: 1 }) !== hZecat);
  check(
    "el orden de los niveles y de las areas NO cambia el hash",
    calcularPublicHash({
      ...cdoBase,
      nivelesImpresion: [{ ...nivel, zecatAreaIds: ["2", "1"] }, { ...nivel, zecatTypeId: "9" }],
      printingUnderMinimumCost: 95000,
    }) ===
      calcularPublicHash({
        ...cdoBase,
        nivelesImpresion: [{ ...nivel, zecatTypeId: "9" }, { ...nivel, zecatAreaIds: ["1", "2"] }],
        printingUnderMinimumCost: 95000,
      })
  );
  check("10 y '10.00' son el mismo unitCost para el hash", calcularPublicHash({ ...cdoBase, nivelesImpresion: [{ ...nivel, unitCost: 10 }], printingUnderMinimumCost: 95000 }) === calcularPublicHash({ ...cdoBase, nivelesImpresion: [{ ...nivel, unitCost: "10.00" }], printingUnderMinimumCost: 95000 }));

  // =========================== 2. syncProduct CONTRA LA BASE ===========================
  console.log("\n=========== 2. syncProduct contra la base ===========");
  await prisma.syncRun.deleteMany({});
  await prisma.quoteItem.deleteMany({});
  await prisma.quote.deleteMany({});
  await prisma.productImage.deleteMany({});
  await prisma.printingArea.deleteMany({});
  await prisma.productPrintingType.deleteMany({});
  await prisma.productAttribute.deleteMany({});
  await prisma.productVariant.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.supplier.deleteMany({});

  const porZecat = (zecatId: string) =>
    prisma.product.findUniqueOrThrow({ where: { zecatId }, include: { printingLevels: true, printingTypes: true } });

  const base = clonar(p5515, "951500");
  const s1 = await syncProduct(base);
  const prod1 = await porZecat("951500");
  check("alta: 16 niveles escritos", prod1.printingLevels.length === 16, String(prod1.printingLevels.length));
  const fila = prod1.printingLevels.find((n) => n.label === "Bordado 2KP");
  check("alta: Bordado 2KP unitCost 877.40 / setupCost 46600 en la base", Number(fila?.unitCost) === 877.4 && Number(fila?.setupCost) === 46600);
  check("alta: areaCm2 10 y zecatAreaIds ['3519']", Number(fila?.areaCm2) === 10 && JSON.stringify(fila?.zecatAreaIds) === JSON.stringify(["3519"]));
  const fdtf = prod1.printingLevels.find((n) => n.label === "Transfer DTF 900 cm2");
  check("alta: DTF 900 setupCost 25500 y 4 areas", Number(fdtf?.setupCost) === 25500 && fdtf?.zecatAreaIds.length === 4);
  check("alta: recargo 95000 en Product.printingUnderMinimumCost", Number(prod1.printingUnderMinimumCost) === 95000);
  check("ProductPrintingType sigue deduplicado por nombre (2: Bordado y Transfer DTF)", prod1.printingTypes.length === 2, prod1.printingTypes.map((t) => t.name).join(","));
  check("alta: sin perdida ni rotura", s1.niveles.perdia === false && s1.niveles.roto === false && s1.niveles.retenido === false);
  check("alta: el producto es nuevo -> cambio publico", s1.cambio === "publico");

  const s2 = await syncProduct(clonar(p5515, "951500"));
  const prod2 = await porZecat("951500");
  check("re-sync identico: siguen 16 niveles (sin duplicar)", prod2.printingLevels.length === 16);
  check("re-sync identico: el hash no cambia (nada que invalidar)", prod2.publicHash === prod1.publicHash && s2.cambio !== "publico");

  const camb = clonar(p5515, "951500");
  camb.printing_types.find((t: Detalle) => t.id === "11").unit_price = 900;
  const s3 = await syncProduct(camb);
  const prod3 = await porZecat("951500");
  check("cambia el unit_price de un nivel: el hash cambia y la ficha se invalida", prod3.publicHash !== prod2.publicHash && s3.cambio === "publico");
  check("... y el valor nuevo quedo escrito", Number(prod3.printingLevels.find((n) => n.zecatTypeId === "11")?.unitCost) === 900);

  const camb2 = clonar(p5515, "951500");
  camb2.customization_under_minimum_extra_cost = 120000;
  camb2.printing_types.find((t: Detalle) => t.id === "11").unit_price = 900;
  const s4 = await syncProduct(camb2);
  check("cambia solo el recargo: tambien invalida", s4.cambio === "publico" && Number((await porZecat("951500")).printingUnderMinimumCost) === 120000);

  // Cada regla rota, sobre un producto que YA tenia niveles: 0 niveles, recargo
  // null, y el producto NO se pausa (sigue activo).
  let n = 0;
  for (const [nombre, mut] of casos) {
    const id = `9516${String(n++).padStart(2, "0")}`;
    await syncProduct(clonar(p5515, id));
    const rotoD = clonar(p5515, id);
    mut(rotoD);
    const avisos: string[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => avisos.push(a.join(" "));
    const r = await syncProduct(rotoD);
    console.warn = warn;
    const p = await porZecat(id);
    check(
      `roto (${nombre}): 0 niveles, recargo null, producto NO pausado, avisa con warn`,
      p.printingLevels.length === 0 && p.printingUnderMinimumCost === null && p.active === true && r.niveles.roto === true && r.niveles.perdia === true && avisos.some((a) => a.includes(id))
    );
  }

  const idAus = "951700";
  await syncProduct(clonar(p5515, idAus));
  const ausD = clonar(p5515, idAus);
  delete ausD.printing_types;
  const rAus = await syncProduct(ausD);
  const pAus = await porZecat(idAus);
  check("el proveedor deja de mandar printing_types: 0 niveles (no quedan viejos) y cuenta como perdida", pAus.printingLevels.length === 0 && rAus.niveles.perdia === true && rAus.niveles.roto === false);

  const idNuevoRoto = "951701";
  const nuevoRoto = clonar(p5515, idNuevoRoto);
  nuevoRoto.printing_types[0].unit_price = "abc";
  const rNR = await syncProduct(nuevoRoto);
  const pNR = await porZecat(idNuevoRoto);
  check("producto NUEVO con el set roto: se crea activo con 0 niveles y no cuenta como perdida", pNR.printingLevels.length === 0 && pNR.active && rNR.niveles.roto === true && rNR.niveles.perdia === false);

  // Retencion: sin cupo, la perdida NO se aplica.
  const idRet = "951800";
  await syncProduct(clonar(p5515, idRet));
  const antes = await porZecat(idRet);
  const retD = clonar(p5515, idRet);
  retD.printing_types = [];
  retD.name = "Bolso renombrado";
  const rRet = await syncProduct(retD, { puedeQuitarNiveles: false });
  const desp = await porZecat(idRet);
  check("retenido: conserva los 16 niveles viejos", desp.printingLevels.length === 16 && rRet.niveles.retenido === true && rRet.niveles.perdia === true);
  check("retenido: conserva el recargo viejo", Number(desp.printingUnderMinimumCost) === 95000);
  check("retenido: lo demas SI se actualiza (el nombre)", desp.name === "Bolso renombrado");
  check("retenido: el hash refleja los niveles RETENIDOS (solo cambio el nombre)", desp.publicHash !== antes.publicHash);
  const retD2 = clonar(p5515, idRet);
  retD2.printing_types = [];
  retD2.name = "Bolso renombrado";
  const rRet2 = await syncProduct(retD2, { puedeQuitarNiveles: false });
  check("retenido otra vez, sin otros cambios: el hash no se mueve", (await porZecat(idRet)).publicHash === desp.publicHash && rRet2.cambio !== "publico");
  const rAplica = await syncProduct(retD2, { puedeQuitarNiveles: true });
  const aplicado = await porZecat(idRet);
  check("cuando hay cupo, la perdida se aplica: 0 niveles (el recargo, valido, es el que manda Zecat)", aplicado.printingLevels.length === 0 && Number(aplicado.printingUnderMinimumCost) === 95000 && rAplica.niveles.retenido === false);
  check("... y como los niveles estaban retenidos, ESE cambio invalida la cache", rAplica.cambio === "publico" && aplicado.publicHash !== desp.publicHash);

  // El set roto tambien se retiene, y se avisa su causa.
  const idRetRoto = "951801";
  await syncProduct(clonar(p5515, idRetRoto));
  const rotoRet = clonar(p5515, idRetRoto);
  rotoRet.printing_types[0].setup_free = true;
  const rr = await syncProduct(rotoRet, { puedeQuitarNiveles: false });
  check("set roto SIN cupo: retiene los viejos y lo marca roto + retenido", (await porZecat(idRetRoto)).printingLevels.length === 16 && rr.niveles.roto === true && rr.niveles.retenido === true);

  // =========================== 3. MOTOR: LA GUARDA POR CORRIDA ===========================
  console.log("\n=========== 3. Motor: guarda por corrida (tope por racha) ===========");
  const { avanzarCorrida } = await import("../src/lib/sync/motor");

  const { levantarZecatFalso } = await import("./_zecat-falso");
  type EstadoFalso = import("./_zecat-falso").EstadoFalso;

  const N = 30;
  const ids = Array.from({ length: N }, (_, i) => `i-${String(i).padStart(3, "0")}`);
  const nivelesFalsos = (id: string) => [
    { id: "11", name: "Bordado", description: "Bordado 2KP", unit_price: 877.4, setup_price: 46600, area: 10, first_logo_free: false, setup_free: false, configuration: { printing_area_printing_types: [{ printing_area_id: 3519 }] } },
    { id: "12", name: "Bordado", description: `Bordado 4KP ${id}`.trim(), unit_price: 1397.13, setup_price: 46600, area: 12, first_logo_free: false, setup_free: false, configuration: { printing_area_printing_types: [] } },
  ];
  const estado: EstadoFalso = {
    listado: [...ids],
    detalle: new Map(),
    demoraDetalleMs: 0,
    listadoCaido: false,
    pedidosDetalle: new Map(),
    impresion: new Map(),
  };
  const conNiveles = (id: string) => estado.impresion!.set(id, { printing_types: nivelesFalsos(id), customization_under_minimum_extra_cost: 95000 });
  const sinNiveles = (id: string) => estado.impresion!.set(id, { printing_types: [] });
  ids.forEach(conNiveles);

  await prisma.syncRun.deleteMany({});
  await prisma.productImage.deleteMany({});
  await prisma.printingArea.deleteMany({});
  await prisma.productPrintingType.deleteMany({});
  await prisma.productVariant.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.supplier.deleteMany({});
  await prisma.supplier.create({ data: { origin: ProductOrigin.ZECAT, name: "Zecat", autoSyncEnabled: true } });
  const zecat = await levantarZecatFalso(estado);
  process.env.ZECAT_API_URL = zecat.url;

  const correr = async () => {
    for (let t = 0; t < 200; t++) {
      const r = await avanzarCorrida(ProductOrigin.ZECAT, "consola", { esCron: false });
      if (r.estado === "completa" || r.estado === "fallo") return r;
    }
    throw new Error("demasiados ticks");
  };
  const envejecer = async () => {
    for (const r of await prisma.syncRun.findMany({ where: { status: { not: SyncRunStatus.RUNNING } } })) {
      await prisma.syncRun.update({
        where: { id: r.id },
        data: { startedAt: new Date(r.startedAt.getTime() - 7 * 3_600_000), finishedAt: r.finishedAt ? new Date(r.finishedAt.getTime() - 7 * 3_600_000) : null },
      });
    }
  };
  const conNivelesEnBase = () => prisma.product.count({ where: { printingLevels: { some: {} } } });
  const mailsNiveles = () => mails.filter((m) => m.asunto.includes("personalización")).length;

  try {
    const c1 = await correr();
    const sum1 = c1.estado === "completa" ? c1.summary : null;
    check("corrida 1 (alta): 30 productos con niveles, ninguno perdido ni roto", (await conNivelesEnBase()) === N && (sum1?.quitadosNiveles?.length ?? 0) === 0 && (sum1?.nivelesRotos?.length ?? 0) === 0);
    check("corrida 1: sin mail de personalizacion", mailsNiveles() === 0);
    const umbral = sum1?.umbral ?? 0;
    check("el umbral es el de siempre: max(10, 5% de los activos) = 10", umbral === 10, String(umbral));

    // Por DEBAJO del umbral: 5 pierden todo -> se aplican y no hay alerta.
    await envejecer();
    ids.slice(0, 5).forEach(sinNiveles);
    const c2 = await correr();
    const sum2 = c2.estado === "completa" ? c2.summary : null;
    check("5 pierden todo (< umbral 10): se APLICAN las 5", (await conNivelesEnBase()) === N - 5 && sum2?.quitadosNiveles?.length === 5 && (sum2?.retenidosNiveles?.length ?? 0) === 0);
    check("... sin tope y sin mail", sum2?.topeNiveles === false && mailsNiveles() === 0);

    // POR ENCIMA: los otros 25 pierden todo -> 10 se aplican y 15 se retienen.
    await envejecer();
    ids.slice(5).forEach(sinNiveles);
    const c3 = await correr();
    const sum3 = c3.estado === "completa" ? c3.summary : null;
    check("25 pierden todo (> umbral): se aplican solo 10", sum3?.quitadosNiveles?.length === 10, String(sum3?.quitadosNiveles?.length));
    check("... y 15 quedan RETENIDOS con sus niveles viejos", sum3?.retenidosNiveles?.length === 15 && (await conNivelesEnBase()) === 15);
    check("... tope alcanzado, sin racha previa", sum3?.topeNiveles === true && sum3?.rachaNiveles === false);
    check("... y se manda el mail de alerta (una vez)", mailsNiveles() === 1, mails.map((m) => m.asunto).join(" || "));
    const mail3 = mails.find((m) => m.asunto.includes("personalización"));
    check("el mail dice cuantos se retuvieron", !!mail3 && mail3.asunto.includes("15"), mail3?.asunto);
    check("los retenidos NO se pausaron: siguen activos", (await prisma.product.count({ where: { active: true, printingLevels: { some: {} } } })) === 15);

    // RACHA: la corrida siguiente no quita ninguno mientras la anterior llego al tope.
    await envejecer();
    const c4 = await correr();
    const sum4 = c4.estado === "completa" ? c4.summary : null;
    check("racha: la corrida siguiente NO aplica ninguna perdida", (sum4?.quitadosNiveles?.length ?? 0) === 0 && (await conNivelesEnBase()) === 15);
    check("racha: los 15 siguen retenidos y se avisa 'sigue la racha'", sum4?.retenidosNiveles?.length === 15 && sum4?.rachaNiveles === true && sum4?.topeNiveles === true && mailsNiveles() === 2);

    // El proveedor se arregla: la racha se corta.
    await envejecer();
    ids.forEach(conNiveles);
    const c5 = await correr();
    const sum5 = c5.estado === "completa" ? c5.summary : null;
    check("el proveedor vuelve a mandar niveles: los 30 con niveles, racha cortada", (await conNivelesEnBase()) === N && sum5?.topeNiveles === false && (sum5?.retenidosNiveles?.length ?? 0) === 0);
    await envejecer();
    ids.slice(0, 3).forEach(sinNiveles);
    const c6 = await correr();
    const sum6 = c6.estado === "completa" ? c6.summary : null;
    check("cortada la racha, una perdida chica (3) se vuelve a aplicar", sum6?.quitadosNiveles?.length === 3 && (await conNivelesEnBase()) === N - 3);

    // Rotos: muchos rotos a la vez (set invalido) y sin niveles previos -> aviso aunque no haya retencion.
    await envejecer();
    ids.forEach((id) =>
      estado.impresion!.set(id, { printing_types: [{ ...nivelesFalsos(id)[0], unit_price: "abc" }], customization_under_minimum_extra_cost: 95000 })
    );
    const antesMails = mailsNiveles();
    const c7 = await correr();
    const sum7 = c7.estado === "completa" ? c7.summary : null;
    check("30 productos rotos: el resumen los cuenta (30 rotos)", sum7?.nivelesRotos?.length === 30, String(sum7?.nivelesRotos?.length));
    check("... 27 tenian niveles: se aplican 10 (el cupo) y se retienen 17", sum7?.quitadosNiveles?.length === 10 && sum7?.retenidosNiveles?.length === 17 && (await conNivelesEnBase()) === 17);
    check("... ninguno se pauso por esto", (await prisma.product.count({ where: { active: false } })) === 0);
    check("... tope alcanzado y alerta", sum7?.topeNiveles === true && mailsNiveles() === antesMails + 1);

    // Rotos masivos SIN retencion (nadie tenia niveles): igual se avisa.
    await envejecer();
    await prisma.productPrintingLevel.deleteMany({});
    const antesMails8 = mailsNiveles();
    const c8 = await correr();
    const sum8 = c8.estado === "completa" ? c8.summary : null;
    check("30 rotos sin niveles previos: 30 rotos, 0 perdidas, 0 retenidos", sum8?.nivelesRotos?.length === 30 && (sum8?.quitadosNiveles?.length ?? 0) === 0 && (sum8?.retenidosNiveles?.length ?? 0) === 0);
    check("... mas rotos que el umbral: alerta aunque no haya retencion", mailsNiveles() === antesMails8 + 1);
  } finally {
    await zecat.cerrar();
  }

  console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLA(S)`}`);
  await prisma.$disconnect();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

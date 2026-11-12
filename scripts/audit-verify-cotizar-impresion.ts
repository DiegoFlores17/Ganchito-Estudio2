// Verificacion de la tanda 4b (personalizacion en la cotizacion), contra la
// base LOCAL. Escribe cotizaciones de prueba y las borra al final; toca el
// umbral de un producto y lo restaura en el finally.
//
//   npx tsx scripts/audit-verify-cotizar-impresion.ts
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { computePrintingPrice, getPricingConfig } from "../src/lib/pricing";
import {
  etiquetaPublica,
  medidaAproximada,
  opcionesDeImpresion,
  resolverSeleccion,
  TEXTO_SELECCION_DESCARTADA,
  tituloArea,
} from "../src/lib/quote-printing";
import { cm2DeLaEtiqueta, normalizarImpresion } from "../src/lib/zecat/impresion";
import { buildQuoteMessage } from "../src/lib/quote-message";
import { aCentavos, formatPriceArsCentavos } from "../src/lib/format";
import { LEYENDAS_PRECIO, impresionEnTotal, leyendaTotalMensaje } from "../src/lib/leyendas-precio";
import { getQuoteItemsSummary, submitQuote } from "../src/app/(store)/cotizar/actions";

// Los mails NUNCA salen de esta maquina: key falsa + fetch interceptado.
process.env.RESEND_API_KEY = "re_fake_para_el_script";
const enviados: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://api.resend.com")) {
    throw new Error(`Request inesperado a ${url}: el script no debe salir a la red.`);
  }
  enviados.push(String((JSON.parse(String(init?.body ?? "{}")) as { html?: string }).html ?? ""));
  return new Response(JSON.stringify({ id: "test-id" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const PAYLOADS =
  "/private/tmp/claude-501/-Users-diego-Downloads-ganchito-estudio/b8a6388d-0918-4316-ab46-62ec863e6346/scratchpad";

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

const D = (v: number | string) => new Prisma.Decimal(v);

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("localhost")) throw new Error("ABORTADO: DATABASE_URL no apunta a localhost.");

  // ---------- 1. Precio puro ----------
  const margen = { defaultMarginPercent: D(45) };
  const p = computePrintingPrice({ unitCost: D("877.40"), setupCost: D("46600") }, margen);
  check("unitario 877,40 x 1,45 = 1272,23", p.unitPrice.toString() === "1272.23", p.unitPrice.toString());
  check("setup 46600 x 1,45 = 67570", p.setupPrice.toString() === "67570", p.setupPrice.toString());
  check("sin datos de recargo -> surcharge null", p.surcharge === null);
  const redondeo = computePrintingPrice({ unitCost: D("0.10"), setupCost: D("0") }, margen);
  check("ROUND_HALF_UP: 0,10 x 1,45 = 0,145 -> 0,15", redondeo.unitPrice.toString() === "0.15", redondeo.unitPrice.toString());
  const bajo = computePrintingPrice({ unitCost: D(1), setupCost: D(1) }, margen, {
    productQuantity: 50, minOrderQuantity: 100, underMinimumCost: D(95000),
  });
  check("recargo debajo del umbral: 95000 x 1,45 = 137750", bajo.surcharge?.toString() === "137750", String(bajo.surcharge));
  const igual = computePrintingPrice({ unitCost: D(1), setupCost: D(1) }, margen, {
    productQuantity: 100, minOrderQuantity: 100, underMinimumCost: D(95000),
  });
  check("en el umbral: sin recargo", igual.surcharge === null);
  const sinUmbral = computePrintingPrice({ unitCost: D(1), setupCost: D(1) }, margen, {
    productQuantity: 1, minOrderQuantity: null, underMinimumCost: D(95000),
  });
  check("umbral null: sin recargo", sinUmbral.surcharge === null);

  // ---------- 2. Opciones y rotulos ----------
  check("medida de 10 cm2", medidaAproximada(10) === "Logo de hasta 3,1 × 3,1 cm", medidaAproximada(10));
  check("medida de 25 cm2", medidaAproximada(25) === "Logo de hasta 5 × 5 cm", medidaAproximada(25));
  const ops = opcionesDeImpresion(
    [
      { zecatTypeId: "a", technique: "Bordado", label: "Bordado 2KP", areaCm2: 10, zecatAreaIds: ["1", "2"] },
      { zecatTypeId: "b", technique: "Bordado", label: "Bordado 22KP", areaCm2: 120, zecatAreaIds: ["1", "2"] },
      { zecatTypeId: "c", technique: "DTP", label: "DTP", areaCm2: 10, zecatAreaIds: [] },
      { zecatTypeId: "d", technique: "Laser", label: "Laser", areaCm2: null, zecatAreaIds: ["1"] },
    ],
    [
      { zecatAreaId: "1", name: "FRENTE", widthCm: 20, heightCm: 5 },
      { zecatAreaId: "2", name: "DORSO", widthCm: null, heightCm: null },
    ]
  );
  check("tecnica sin area no se ofrece", !ops.some((o) => o.technique === "DTP"));
  check("nivel sin areaCm2 no se ofrece", !ops.some((o) => o.technique === "Laser"));
  check("120 cm2 no entra en 20x5 (100)", !ops.some((o) => o.zecatTypeId === "b" && o.zecatAreaId === "1"));
  check("area sin medidas no filtra", ops.some((o) => o.zecatTypeId === "b" && o.zecatAreaId === "2"));
  check("ningun rotulo publico dice KP", ops.every((o) => !/KP/i.test(o.sizeLabel) && !/KP/i.test(etiquetaPublica(o))));
  check("seleccion ajena -> invalida", resolverSeleccion(ops, { zecatTypeId: "zzz", zecatAreaId: "1" }).tipo === "invalida");
  check("area que no entra -> invalida", resolverSeleccion(ops, { zecatTypeId: "b", zecatAreaId: "1" }).tipo === "invalida");
  check("basura -> invalida", resolverSeleccion(ops, 42).tipo === "invalida");
  check("sin seleccion -> ausente", resolverSeleccion(ops, undefined).tipo === "ausente");
  check("'ninguna' -> ninguna", resolverSeleccion(ops, "ninguna").tipo === "ninguna");

  // ---------- 3. Aviso etiqueta vs area (sync) ----------
  check("cm2 de la etiqueta DTF 900", cm2DeLaEtiqueta("Transfer DTF 900 cm2") === 900);
  check("bordado no tiene cm2 en la etiqueta", cm2DeLaEtiqueta("Bordado 2KP") === null);
  const p3965 = path.join(PAYLOADS, "zp-3965.json");
  if (fs.existsSync(p3965)) {
    const crudo = JSON.parse(fs.readFileSync(p3965, "utf8"));
    const r = normalizarImpresion(crudo.generic_product ?? crudo);
    check(
      "3965: aviso de etiqueta 900 vs area 1100, sin romper el set",
      r.tipo === "ok" && r.avisos.some((a) => a.includes("900") && a.includes("1100")),
      r.tipo === "ok" ? r.avisos.join(" | ") : "roto"
    );
  } else {
    console.log("SKIP  3965: falta zp-3965.json");
  }

  // ---------- 4. Leyendas y mensaje ----------
  check(
    "impresionEnTotal por caso",
    impresionEnTotal({ conImpresion: 0, sinPrecio: 1 }) === "ninguna" &&
      impresionEnTotal({ conImpresion: 2, sinPrecio: 0 }) === "toda" &&
      impresionEnTotal({ conImpresion: 1, sinPrecio: 1 }) === "parcial" &&
      impresionEnTotal({ conImpresion: 0, sinPrecio: 0 }) === "soloEnvio"
  );
  check("area en formato titulo, sin mapeos", tituloArea("DORSO Bordado") === "Dorso Bordado" && tituloArea("BORDADO") === "Bordado");
  const linea = { productName: "X", variantLabel: null, printingType: "Bordado · hasta 3,1 × 3,1 cm · FRENTE (estimado)", quantity: 1, subtotal: 1 };
  const largo = buildQuoteMessage({
    shortCode: "ABC234", customerName: "N", companyName: null, customerEmail: "a@b.c",
    lines: Array.from({ length: 60 }, () => linea), total: 1,
    sufijoTotal: LEYENDAS_PRECIO.totalMensajeImpresionParcial, formatPrice: (v) => `$ ${v}`,
  });
  check("mensaje con sufijo largo respeta 1500", largo.length <= 1500, String(largo.length));
  check("mensaje lleva el sufijo pedido", largo.includes(LEYENDAS_PRECIO.totalMensajeImpresionParcial));

  // ---------- 5. Server actions contra la base local ----------
  const producto = await prisma.product.findFirst({
    where: { zecatId: "5515", active: true, deletedAt: null },
    include: { variants: { where: { active: true }, take: 1 } },
  });
  if (!producto) throw new Error("FIXTURE: falta el 5515 activo en local");
  const sku = producto.variants[0].sku;
  const minimoOriginal = producto.minOrderQuantity;
  const creadas: string[] = [];
  const config = await getPricingConfig();

  try {
    // Umbral alto para forzar el recargo; se restaura en el finally.
    await prisma.product.update({ where: { id: producto.id }, data: { minOrderQuantity: 100 } });

    const items = [{ productId: producto.id, variantSku: sku, quantity: 3 }];
    const resumen = await getQuoteItemsSummary(items);
    const imp = resumen.printing.find((x) => x.productId === producto.id);
    check("resumen trae opciones para 5515", !!imp && imp.opciones.length > 0, String(imp?.opciones.length));
    const def = imp?.opciones.find((o) => o.key === imp.seleccion);
    check("preseleccion = la mas chica (3,1 × 3,1 cm)", def?.sizeLabel === "Logo de hasta 3,1 × 3,1 cm", def?.sizeLabel);

    // El payload que viaja al navegador.
    const payload = JSON.stringify(resumen);
    // El MONTO del adicional puede viajar (decision de Diego, 2026-11-11); el
    // umbral, los costos crudos y la etiqueta de Zecat no.
    const prohibidos = ["95000", "minOrderQuantity", "printingUnderMinimumCost", "unitCost", "setupCost", "levelLabel", "KP", '"100"', ":100,"];
    for (const x of prohibidos) check(`payload del resumen sin ${x}`, !payload.includes(x));

    // Debajo del umbral (3 < 100): el resumen trae el monto del adicional.
    check("resumen bajo el minimo: adicional 137750", imp?.surcharge === 137750, String(imp?.surcharge));

    // Precio del resumen = la misma funcion.
    const nivel2kp = await prisma.productPrintingLevel.findFirst({
      where: { productId: producto.id, label: "Bordado 2KP" },
    });
    const bordadoFrente = imp?.opciones.find((o) => o.zecatTypeId === nivel2kp?.zecatTypeId && o.zecatAreaId === "3519");
    const esperado = nivel2kp ? computePrintingPrice(nivel2kp, config) : null;
    check(
      "resumen: Bordado FRENTE con el precio de computePrintingPrice",
      !!bordadoFrente && !!esperado && bordadoFrente.unitPrice === Number(esperado.unitPrice) && bordadoFrente.setupPrice === Number(esperado.setupPrice),
      `${bordadoFrente?.unitPrice} / ${bordadoFrente?.setupPrice}`
    );

    const form = (printing?: unknown) => {
      const f = new FormData();
      f.set("customerName", "Test Impresion 4b");
      f.set("customerEmail", "impresion4b@test.local");
      f.set("items", JSON.stringify(items));
      f.set("privacyAccepted", "on");
      if (printing !== undefined) f.set("printing", JSON.stringify(printing));
      return f;
    };

    // a) Seleccion valida, debajo del umbral.
    enviados.length = 0;
    const a = await submitQuote(form({ [producto.id]: { zecatTypeId: bordadoFrente!.zecatTypeId, zecatAreaId: bordadoFrente!.zecatAreaId } }));
    if (a.quoteId) creadas.push(a.quoteId);
    const qa = await prisma.quote.findUnique({ where: { id: a.quoteId ?? "" }, include: { printings: true, items: true } });
    const fila = qa?.printings[0];
    check("a) cotizacion creada con una fila de personalizacion", a.success && qa?.printings.length === 1);
    check("a) unitario y setup congelados", fila?.unitPrice.toString() === esperado?.unitPrice.toString() && fila?.setupPrice.toString() === esperado?.setupPrice.toString(), `${fila?.unitPrice} / ${fila?.setupPrice}`);
    check("a) recargo congelado (3 < 100)", fila?.surcharge?.toString() === "137750", String(fila?.surcharge));
    check("a) estimado y cantidad", fila?.estimated === true && fila?.quantity === 3);
    check("a) nivel interno guardado", fila?.levelLabel === "Bordado 2KP");
    check("a) printingType publico en el item", qa?.items[0].printingType === fila?.publicLabel && !/KP/.test(qa?.items[0].printingType ?? ""), qa?.items[0].printingType ?? "null");
    check("a) sin descartadas", qa?.printingDroppedProductIds.length === 0);
    const mailA = enviados.join("\n");
    check("a) mail: Personalizacion y Preparacion del logo", mailA.includes("Personalización —") && mailA.includes("Preparación del logo —"));
    check("a) mail: linea de adicional con su monto", mailA.includes("Adicional por cantidad chica") && mailA.includes("137.750"));
    check("a) mail: el umbral queda como nota interna", mailA.includes("Interno: Personalización con recargo del proveedor (sin recargo desde 100 un.)"));
    check("a) mail: nivel interno visible para Ganchito", mailA.includes("nivel Bordado 2KP"));
    check("a) mail: leyenda de total con personalizacion", mailA.includes(leyendaTotalMensaje("toda")));
    // El total del mail = productos + personalizacion + setup + adicional, en
    // centavos y con centavos a la vista.
    const totalCent =
      aCentavos(qa!.items[0].unitPrice) * 3 + aCentavos(fila!.unitPrice) * 3 + aCentavos(fila!.setupPrice) + aCentavos(fila!.surcharge!);
    const totalFmt = formatPriceArsCentavos(totalCent / 100);
    check("a) mail: total CON el adicional, con centavos", mailA.includes(`Total: <strong>${totalFmt}</strong>`), totalFmt);
    // El resumen da el mismo total que el mail (lo que el cliente vio = lo congelado).
    const totalResumen =
      resumen.items.reduce((acc, it) => acc + it.subtotalCentavos, 0) +
      aCentavos(bordadoFrente!.unitPrice) * 3 + aCentavos(bordadoFrente!.setupPrice) + aCentavos(imp!.surcharge ?? 0);
    check("a) total del resumen = total del mail", totalResumen === totalCent, formatPriceArsCentavos(totalResumen / 100));
    // Unitario x cantidad = subtotal, a la vista (punto 3 del QA).
    const unitMail = formatPriceArsCentavos(fila!.unitPrice);
    const subMail = formatPriceArsCentavos((aCentavos(fila!.unitPrice) * 3) / 100);
    check("a) mail: unitario de personalizacion con centavos y su subtotal exacto", mailA.includes(unitMail) && mailA.includes(subMail) && unitMail.includes(","), `${unitMail} x 3 = ${subMail}`);
    const prodUnit = formatPriceArsCentavos(qa!.items[0].unitPrice);
    const prodSub = formatPriceArsCentavos((aCentavos(qa!.items[0].unitPrice) * 3) / 100);
    check("a) mail: unitario de producto con centavos y su subtotal exacto", mailA.includes(prodUnit) && mailA.includes(prodSub), `${prodUnit} x 3 = ${prodSub}`);
    check("a) resumen: rotulo unitario x cantidad = rotulo subtotal", resumen.items.every((it) => {
      const unit = Number(it.unitPriceLabel.replace(/[^\d,]/g, "").replace(",", "."));
      return formatPriceArsCentavos((Math.round(unit * 100) * it.quantity) / 100) === it.subtotalLabel;
    }));
    check("a) area en formato titulo en la etiqueta publica", (fila?.publicLabel ?? "").includes("· Frente (estimado)"), fila?.publicLabel);
    check("a) mail: con personalizacion bajo el minimo -> marca de recargo", mailA.includes("Personalización con recargo del proveedor (sin recargo desde 100 un.)"));
    if (a.waUrl) {
      const texto = decodeURIComponent(a.waUrl.split("text=")[1] ?? "");
      check("a) WhatsApp: total CON el adicional y <= 1500", texto.includes(`Total estimado: ${totalFmt}`) && texto.length <= 1500, `${texto.length} chars`);
      check("a) WhatsApp: sin el umbral", !/sin recargo desde|100 un/.test(texto));
    } else {
      console.log("SKIP  WhatsApp: no hay whatsappNumber en la config local");
    }

    // b) Seleccion ajena: sin personalizacion, marcada, no rechaza.
    enviados.length = 0;
    const b = await submitQuote(form({ [producto.id]: { zecatTypeId: "no-existe", zecatAreaId: "3519" } }));
    if (b.quoteId) creadas.push(b.quoteId);
    const qb = await prisma.quote.findUnique({ where: { id: b.quoteId ?? "" }, include: { printings: true, items: true } });
    check("b) no se rechaza", b.success === true, b.error ?? "");
    check("b) sin fila de personalizacion", qb?.printings.length === 0);
    check("b) producto marcado como descartado", qb?.printingDroppedProductIds.includes(producto.id) === true);
    check("b) item sin printingType", qb?.items[0].printingType === null);
    check("b) mail lleva la marca", enviados.join("\n").includes(TEXTO_SELECCION_DESCARTADA.slice(0, 40)));

    // c) Sin campo printing (pestana vieja): sin personalizacion y SIN marca.
    const c = await submitQuote(form());
    if (c.quoteId) creadas.push(c.quoteId);
    const qc = await prisma.quote.findUnique({ where: { id: c.quoteId ?? "" }, include: { printings: true } });
    check("c) pestana vieja: sin fila y sin marca", c.success && qc?.printings.length === 0 && qc?.printingDroppedProductIds.length === 0);

    // d) "ninguna": sin fila, sin marca de descarte. Bajo el umbral, el mail
    // no afirma una personalizacion que no hay (punto 2 del QA), y la leyenda
    // no promete personalizacion aparte (punto 5).
    enviados.length = 0;
    const d = await submitQuote(form({ [producto.id]: "ninguna" }));
    if (d.quoteId) creadas.push(d.quoteId);
    const qd = await prisma.quote.findUnique({ where: { id: d.quoteId ?? "" }, include: { printings: true } });
    check("d) 'ninguna': sin fila y sin marca", d.success && qd?.printings.length === 0 && qd?.printingDroppedProductIds.length === 0);
    const mailD = enviados.join("\n");
    check("d) mail: sin personalizar bajo el umbral -> nota condicional", mailD.includes("Bajo el umbral del proveedor: si se personaliza, lleva recargo (sin recargo desde 100 un.)"));
    check("d) mail: no afirma 'Personalización con recargo'", !mailD.includes("Personalización con recargo del proveedor"));
    check("d) mail: sin adicional", !mailD.includes("Adicional por cantidad chica"));
    check("d) mail: leyenda 'solo envio'", mailD.includes(`+ IVA ${leyendaTotalMensaje("soloEnvio")}`));

    // h) Con personalizacion + un producto personalizable SIN precios (CDO):
    // la leyenda mantiene la frase de parcial.
    const cdo = await prisma.product.findFirst({
      where: { origin: "CDO", active: true, deletedAt: null, printingTypes: { some: {} }, variants: { some: { active: true } } },
      include: { variants: { where: { active: true }, take: 1 } },
    });
    if (cdo) {
      enviados.length = 0;
      const fh = form({ [producto.id]: { zecatTypeId: bordadoFrente!.zecatTypeId, zecatAreaId: bordadoFrente!.zecatAreaId } });
      fh.set("items", JSON.stringify([...items, { productId: cdo.id, variantSku: cdo.variants[0].sku, quantity: 2 }]));
      const h = await submitQuote(fh);
      if (h.quoteId) creadas.push(h.quoteId);
      check("h) con personalizacion + CDO sin precios: leyenda parcial", enviados.join("\n").includes(`+ IVA ${leyendaTotalMensaje("parcial")}`));
      const resH = await getQuoteItemsSummary(JSON.parse(String(fh.get("items"))));
      check("h) resumen: el CDO viene personalizable y sin opciones", resH.items.some((i) => i.productId === cdo.id && i.personalizable) && !resH.printing.some((p) => p.productId === cdo.id));
    } else {
      console.log("SKIP  h) no hay producto CDO personalizable en local");
    }

    // e) JSON roto en printing: igual que ausente.
    const fe = form();
    fe.set("printing", "{roto");
    const e = await submitQuote(fe);
    if (e.quoteId) creadas.push(e.quoteId);
    check("e) printing roto no rechaza", e.success === true);

    // f) En el umbral: sin recargo.
    await prisma.product.update({ where: { id: producto.id }, data: { minOrderQuantity: 3 } });
    const f = await submitQuote(form({ [producto.id]: { zecatTypeId: bordadoFrente!.zecatTypeId, zecatAreaId: bordadoFrente!.zecatAreaId } }));
    if (f.quoteId) creadas.push(f.quoteId);
    const qf = await prisma.quote.findUnique({ where: { id: f.quoteId ?? "" }, include: { printings: true } });
    check("f) cantidad = umbral: sin recargo", qf?.printings[0]?.surcharge === null);
    const resumenUmbral = await getQuoteItemsSummary(items);
    check("f) resumen en el umbral: sin adicional", resumenUmbral.printing[0]?.surcharge === null);
    await prisma.product.update({ where: { id: producto.id }, data: { minOrderQuantity: 2 } });
    const resumenArriba = await getQuoteItemsSummary(items);
    check("f) resumen arriba del umbral: sin adicional", resumenArriba.printing[0]?.surcharge === null);

    // g) La respuesta de submitQuote (vuelve al navegador) no lleva costos
    // crudos ni el umbral.
    const respuesta = JSON.stringify(a);
    check("g) respuesta de submitQuote sin 95000 ni umbral", !respuesta.includes("95000") && !respuesta.includes("95.000") && !respuesta.includes("minOrderQuantity"));
  } finally {
    await prisma.product.update({ where: { id: producto.id }, data: { minOrderQuantity: minimoOriginal } });
    if (creadas.length) await prisma.quote.deleteMany({ where: { id: { in: creadas } } });
    console.log(`[restore] umbral ${minimoOriginal} restaurado; ${creadas.length} cotizacion(es) de prueba borradas`);
    await prisma.$disconnect();
  }

  console.log(fallos === 0 ? "\nTodos los chequeos pasan." : `\n${fallos} chequeo(s) FALLAN.`);
  if (fallos > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

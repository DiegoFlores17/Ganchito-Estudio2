// Verificacion de la auditoria (hallazgo 1). Script temporal de la rama:
// prueba las acciones publicas de /cotizar contra la base LOCAL.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { computeSellPriceForQuantity, getPricingConfig } from "../src/lib/pricing";
import { POLITICA_PRIVACIDAD_VERSION } from "../src/lib/privacidad";
import { productosBajoMinimo } from "../src/lib/quote-minimum";
import {
  getQuoteItemsSummary,
  submitQuote,
} from "../src/app/(store)/cotizar/actions";

async function main() {
  // Guarda de entorno: este script escribe (crea una cotizacion de prueba).
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("localhost")) {
    throw new Error("ABORTADO: DATABASE_URL no apunta a localhost.");
  }

  // Un producto vivo con variante, y uno para pausar.
  const vivo = await prisma.product.findFirst({
    where: { active: true, deletedAt: null, variants: { some: { active: true } } },
    include: { variants: { where: { active: true }, take: 1 } },
    orderBy: { name: "asc" },
  });
  if (!vivo) throw new Error("FIXTURE: no hay producto vivo con variante ACTIVA");
  const pausado = await prisma.product.findFirst({
    where: { active: true, deletedAt: null, variants: { some: { active: true } }, id: { not: vivo.id } },
    include: { variants: { where: { active: true }, take: 1 } },
    orderBy: { name: "desc" },
  });
  if (!pausado) throw new Error("FIXTURE: no hay segundo producto vivo con variante ACTIVA");

  const conteoInicial = await prisma.quote.count();
  const minimoOriginal = vivo.minOrderQuantity;
  const creadas: string[] = [];
  let fallos = 0;
  const check = (nombre: string, ok: boolean, detalle = "") => {
    if (!ok) fallos++;
    console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  };
  const formulario = (items: unknown[], extra: Record<string, string | File> = {}) => {
    const f = new FormData();
    f.set("customerName", "Test Fix Servidor");
    f.set("customerEmail", "fixservidor@test.local");
    f.set("items", JSON.stringify(items));
    f.set("privacyAccepted", "on");
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };

  try {
    // Pausar el segundo para el test. Va DENTRO del try: el finally lo
    // restaura pase lo que pase, asi un fallo nunca deja la base sucia.
    await prisma.product.update({ where: { id: pausado.id }, data: { active: false } });
    const sku = vivo.variants[0].sku;
    const skuPausado = pausado.variants[0].sku;

    // 1) Summary: cantidad negativa, decimal, cero, gigante -> descartadas;
    //    producto pausado -> al aviso con nombre; linea valida -> entra.
    const summary = await getQuoteItemsSummary([
      { productId: vivo.id, variantSku: sku, quantity: 3 },
      { productId: vivo.id, variantSku: sku, quantity: -5 },
      { productId: vivo.id, variantSku: sku, quantity: 2.5 },
      { productId: vivo.id, variantSku: sku, quantity: 0 },
      { productId: vivo.id, variantSku: sku, quantity: 99999999 },
      { productId: pausado.id, variantSku: skuPausado, quantity: 1 },
      { productId: "id-inexistente", variantSku: "x", quantity: 1 },
    ] as never);
    console.log("[summary] lineas validas:", summary.items.length, "(esperado 1)");
    console.log("[summary] no disponibles:", summary.unavailableNames, "(esperado: nombre del pausado + 'un producto eliminado')");

    // 2) Array gigante -> rechazado entero.
    const gigante = Array.from({ length: 51 }, () => ({ productId: vivo.id, variantSku: sku, quantity: 1 }));
    const s2 = await getQuoteItemsSummary(gigante as never);
    console.log("[summary] array de 51:", s2.items.length, "items (esperado 0)");

    // 3) submitQuote: linea valida + pausado -> success con omittedProducts.
    const fd = new FormData();
    fd.set("customerName", "Test Auditoria");
    fd.set("customerEmail", "auditoria@test.local");
    fd.set("items", JSON.stringify([
      { productId: vivo.id, variantSku: sku, quantity: 2 },
      { productId: pausado.id, variantSku: skuPausado, quantity: 1 },
    ]));
    fd.set("privacyAccepted", "on");
    const r = await submitQuote(fd);
    if (r.quoteId) creadas.push(r.quoteId);
    console.log("[submit] success:", r.success, "| omitidos:", r.omittedProducts, "(esperado: nombre del pausado)");

    // 4) submitQuote solo con cantidad invalida -> error, no 500.
    const fd2 = new FormData();
    fd2.set("customerName", "Test");
    fd2.set("customerEmail", "t@t.co");
    fd2.set("items", JSON.stringify([{ productId: vivo.id, variantSku: sku, quantity: -3 }]));
    fd2.set("privacyAccepted", "on");
    const r2 = await submitQuote(fd2);
    console.log("[submit] solo negativa -> success:", r2.success, "| error:", r2.error, "(esperado: false + 'Agrega al menos...')");

    // 4b) Politica de privacidad: sin el checkbox (o con un valor que no es
    //     "on") se rechaza llamando la accion directo, sin crear nada.
    const antes = await prisma.quote.count();
    for (const valor of [null, "", "off", "true"]) {
      const fd3 = new FormData();
      fd3.set("customerName", "Sin Aceptar");
      fd3.set("customerEmail", "sinaceptar@test.local");
      fd3.set("items", JSON.stringify([{ productId: vivo.id, variantSku: sku, quantity: 1 }]));
      if (valor !== null) fd3.set("privacyAccepted", valor);
      const r3 = await submitQuote(fd3);
      console.log(`[privacidad] privacyAccepted=${JSON.stringify(valor)} -> success:`, r3.success, "| error:", r3.error, "(esperado: false + 'tenés que aceptar...')");
    }
    console.log("[privacidad] cotizaciones creadas sin aceptar:", (await prisma.quote.count()) - antes, "(esperado 0)");

    // 5) La cotizacion creada en (3) conserva SOLO la linea valida, con cantidad 2,
    //    y guarda la aceptacion con fecha del servidor y la version vigente.
    if (r.quoteId) {
      const q = await prisma.quote.findUnique({ where: { id: r.quoteId }, include: { items: true } });
      console.log("[db] items guardados:", q?.items.length, "| quantity:", q?.items[0]?.quantity, "(esperado 1 y 2)");
      const segundos = q?.privacyAcceptedAt ? Math.abs(Date.now() - q.privacyAcceptedAt.getTime()) / 1000 : null;
      console.log("[db] privacyVersion:", q?.privacyVersion, `(esperado ${POLITICA_PRIVACIDAD_VERSION})`, "| privacyAcceptedAt hace", segundos, "s (esperado < 60)");
      await prisma.quote.delete({ where: { id: r.quoteId } });
      console.log("[db] cotizacion de prueba borrada");
    }

    // ===== Fix servidor: linea sin sku y minimo de compra =====
    console.log("\n=========== LINEA SIN SKU ===========");
    // a) la linea sin sku se omite (NO toma variants[0]); la otra se guarda.
    const ra = await submitQuote(
      formulario([
        { productId: vivo.id, quantity: 1 },
        { productId: vivo.id, variantSku: sku, quantity: 2 },
      ])
    );
    if (ra.quoteId) creadas.push(ra.quoteId);
    const qa = ra.quoteId
      ? await prisma.quote.findUnique({ where: { id: ra.quoteId }, include: { items: true } })
      : null;
    check(
      "a) sin sku se omite y las demas se guardan",
      ra.success && qa?.items.length === 1 && qa.items[0].variantSku === sku && qa.items[0].quantity === 2,
      `items=${qa?.items.length} sku=${qa?.items[0]?.variantSku} qty=${qa?.items[0]?.quantity}`
    );

    // b) TODAS omitidas -> rechazo, sin fila nueva. Dos causas: sin sku y sku
    //    inexistente. Con un logo de extension invalida: si el rechazo llega
    //    ANTES del logo, el error es el de "no disponible"; si llegara despues,
    //    seria "Formato no permitido" (y asi se detecta el orden sin subir
    //    nada a Blob).
    const logoInvalido = new File(["x"], "arte.exe");
    for (const [causa, lineas] of [
      ["sin sku", [{ productId: vivo.id, quantity: 1 }]],
      ["sku inexistente", [{ productId: vivo.id, variantSku: "no-existe", quantity: 1 }]],
    ] as const) {
      const antesB = await prisma.quote.count();
      const rb = await submitQuote(formulario([...lineas], { logo: logoInvalido }));
      if (rb.quoteId) creadas.push(rb.quoteId);
      const despuesB = await prisma.quote.count();
      check(
        `b) todas omitidas (${causa}) -> rechazada, sin cotizacion`,
        !rb.success && despuesB === antesB && rb.error === "Ninguno de los productos de la cotización está disponible.",
        `success=${rb.success} error=${JSON.stringify(rb.error)} count ${antesB}->${despuesB}`
      );
    }

    console.log("\n=========== MINIMO DE COMPRA ===========");
    await prisma.product.update({ where: { id: vivo.id }, data: { minOrderQuantity: 10 } });
    // c) debajo del minimo: se crea igual y se guarda el snapshot.
    const rc = await submitQuote(formulario([{ productId: vivo.id, variantSku: sku, quantity: 2 }]));
    if (rc.quoteId) creadas.push(rc.quoteId);
    const qc = rc.quoteId
      ? await prisma.quote.findUnique({ where: { id: rc.quoteId }, include: { items: true } })
      : null;
    check(
      "c) debajo del minimo: se crea y guarda el snapshot",
      rc.success && qc?.items[0]?.minOrderQuantity === 10 && qc.items[0].quantity === 2,
      `snapshot=${qc?.items[0]?.minOrderQuantity}`
    );
    check(
      "c) el helper marca el producto",
      qc !== null && productosBajoMinimo(qc.items).get(vivo.id) === 10
    );

    // d) en o sobre el minimo: sin marca. Por LINEA seria 6 < 10, pero el
    //    minimo es por PRODUCTO (igual que /cotizar): 6 + 6 = 12 >= 10.
    const rd = await submitQuote(
      formulario([
        { productId: vivo.id, variantSku: sku, quantity: 6 },
        { productId: vivo.id, variantSku: sku, quantity: 6 },
      ])
    );
    if (rd.quoteId) creadas.push(rd.quoteId);
    const qd = rd.quoteId
      ? await prisma.quote.findUnique({ where: { id: rd.quoteId }, include: { items: true } })
      : null;
    check(
      "d) total del producto sobre el minimo (6+6 vs 10): sin marca",
      rd.success && qd !== null && productosBajoMinimo(qd.items).size === 0,
      `lineas=${qd?.items.length}`
    );
    const re = await submitQuote(formulario([{ productId: vivo.id, variantSku: sku, quantity: 10 }]));
    if (re.quoteId) creadas.push(re.quoteId);
    const qe = re.quoteId
      ? await prisma.quote.findUnique({ where: { id: re.quoteId }, include: { items: true } })
      : null;
    check(
      "d) justo en el minimo (10 vs 10): sin marca",
      re.success && qe !== null && productosBajoMinimo(qe.items).size === 0
    );
    // Cotizacion vieja: snapshot null -> nunca marca.
    check(
      "d) snapshot null (cotizacion vieja): sin marca",
      productosBajoMinimo([{ productId: "x", quantity: 1, minOrderQuantity: null }]).size === 0
    );

    // ===== Tramo de descuento: las lineas omitidas no cuentan =====
    console.log("\n=========== TRAMO CON LINEAS OMITIDAS ===========");
    const cfg = await getPricingConfig();
    const cands = await prisma.product.findMany({
      where: { active: true, deletedAt: null, id: { not: pausado.id } },
      include: { variants: { where: { active: true } } },
      take: 400,
    });
    let tier: { productId: string; v: (typeof cands)[number]["variants"][number]; cur: (typeof cands)[number]["currency"] } | null = null;
    for (const p of cands) {
      for (const v of p.variants) {
        if (!v.discountTiers) continue;
        if (!computeSellPriceForQuantity(v, p.currency, cfg, 1).equals(computeSellPriceForQuantity(v, p.currency, cfg, 1001))) {
          tier = { productId: p.id, v, cur: p.currency };
          break;
        }
      }
      if (tier) break;
    }
    check("fixture: producto local con tramos cuyo precio difiere entre 1 y 1001", tier !== null);
    if (tier) {
      const p1 = computeSellPriceForQuantity(tier.v, tier.cur, cfg, 1);
      const lineas = [
        { productId: tier.productId, variantSku: tier.v.sku, quantity: 1 },
        { productId: tier.productId, variantSku: "no-existe", quantity: 1000 },
        { productId: tier.productId, quantity: 1000 },
        { productId: pausado.id, variantSku: pausado.variants[0].sku, quantity: 1000 },
      ];
      const rt = await submitQuote(formulario(lineas));
      if (rt.quoteId) creadas.push(rt.quoteId);
      const qt = rt.quoteId
        ? await prisma.quote.findUnique({ where: { id: rt.quoteId }, include: { items: true } })
        : null;
      check(
        "tramo: submitQuote cobra el tramo de la cantidad que sobrevive (1), no 1001",
        rt.success && qt?.items.length === 1 && qt.items[0].unitPrice.equals(p1.toDecimalPlaces(2)),
        `guardado=${qt?.items[0]?.unitPrice} esperado(qty 1)=${p1}`
      );
      const sm = await getQuoteItemsSummary(lineas as never);
      check(
        "tramo: getQuoteItemsSummary cobra el mismo tramo (subtotal exacto, no el rotulo redondeado)",
        sm.items.length === 1 && sm.items[0].subtotal === Number(p1),
        `subtotal=${sm.items[0]?.subtotal} esperado=${Number(p1)}`
      );
    }
  } finally {
    // Cada restauracion es independiente: que una falle no salta las otras.
    // (vivo y pausado son productos distintos, asi que son dos updates.)
    const restaurar = async (que: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        console.log(`[restore] ${que}: ok`);
      } catch (e) {
        fallos++;
        console.error(`[restore] FALLO al restaurar ${que}:`, e);
      }
    };
    await restaurar("cotizaciones creadas", () =>
      prisma.quote.deleteMany({ where: { id: { in: creadas } } })
    );
    await restaurar(`minimo de compra (${minimoOriginal})`, () =>
      prisma.product.update({ where: { id: vivo.id }, data: { minOrderQuantity: minimoOriginal } })
    );
    await restaurar("producto pausado (active=true)", () =>
      prisma.product.update({ where: { id: pausado.id }, data: { active: true } })
    );
    const conteoFinal = await prisma.quote.count();
    console.log(`[restore] cotizaciones: antes=${conteoInicial} despues=${conteoFinal}`);
    if (conteoFinal !== conteoInicial) fallos++;
    console.log(fallos ? `\n${fallos} chequeo(s) fallaron.` : "\nTodos los chequeos pasan.");
    if (fallos) process.exitCode = 1;
  }
}

main().finally(() => prisma.$disconnect());

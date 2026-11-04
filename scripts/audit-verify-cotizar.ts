// Verificacion de la auditoria (hallazgo 1). Script temporal de la rama:
// prueba las acciones publicas de /cotizar contra la base LOCAL.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { computeSellPriceForQuantity, getPricingConfig } from "../src/lib/pricing";
import { POLITICA_PRIVACIDAD_VERSION } from "../src/lib/privacidad";
import { productosConRecargo } from "../src/lib/quote-minimum";
import { QuoteStatus } from "@prisma/client";
import { cantidadRestante, esCotizacionCerrada, lineasSobreElStock } from "../src/lib/quote-stock";
import {
  getQuoteItemsSummary,
  submitQuote,
} from "../src/app/(store)/cotizar/actions";

// Los mails NUNCA salen de esta maquina: key falsa + fetch interceptado. Se
// guarda lo que el SDK de Resend habria mandado para chequear el contenido
// del aviso a Ganchito (marca de recargo y marca de stock).
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
  const stockOriginal = {
    stock: vivo.variants[0].stock,
    reservedStock: vivo.variants[0].reservedStock,
  };
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
    const RECARGO = "Personalización con recargo del proveedor (sin recargo desde 10 un.)";
    check(
      "c) el mail a Ganchito lleva la leyenda de recargo",
      enviados.at(-1)?.includes(RECARGO) === true && !enviados.at(-1)?.includes("Debajo del mínimo"),
      `mails=${enviados.length}`
    );
    check(
      "c) el helper marca el producto",
      qc !== null && productosConRecargo(qc.items).get(vivo.id) === 10
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
      rd.success && qd !== null && productosConRecargo(qd.items).size === 0,
      `lineas=${qd?.items.length}`
    );
    const re = await submitQuote(formulario([{ productId: vivo.id, variantSku: sku, quantity: 10 }]));
    if (re.quoteId) creadas.push(re.quoteId);
    const qe = re.quoteId
      ? await prisma.quote.findUnique({ where: { id: re.quoteId }, include: { items: true } })
      : null;
    check(
      "d) justo en el minimo (10 vs 10): sin marca",
      re.success && qe !== null && productosConRecargo(qe.items).size === 0
    );
    check(
      "d) justo en el umbral: el mail no lleva la leyenda de recargo",
      enviados.at(-1)?.includes("con recargo del proveedor") === false
    );
    // Cotizacion vieja: snapshot null -> nunca marca.
    check(
      "d) snapshot null (cotizacion vieja): sin marca",
      productosConRecargo([{ productId: "x", quantity: 1, minOrderQuantity: null }]).size === 0
    );

    console.log("\n=========== PEDIDO MAYOR AL STOCK ===========");
    // Stock controlado: disponible = 5 - 2 = 3. El umbral de recargo queda
    // en 10 (seteado arriba), asi se prueba que las dos marcas son
    // independientes.
    const varianteId = vivo.variants[0].id;
    await prisma.productVariant.update({ where: { id: varianteId }, data: { stock: 5, reservedStock: 2 } });
    const STOCK = "Pedido mayor al stock del último sync (stock: 3)";
    const cotizarMail = async (cantidades: number[]) => {
      const antesMails = enviados.length;
      const r = await submitQuote(formulario(cantidades.map((quantity) => ({ productId: vivo.id, variantSku: sku, quantity }))));
      if (r.quoteId) creadas.push(r.quoteId);
      return { ok: r.success, mail: enviados.length === antesMails + 1 ? enviados.at(-1)! : null };
    };
    const g1 = await cotizarMail([4]);
    check("g) cantidad 4 > disponible 3: el mail lleva la marca de stock", g1.ok && g1.mail?.includes(STOCK) === true);
    const g2 = await cotizarMail([3]);
    check("g) cantidad 3 == disponible 3: sin marca", g2.ok && g2.mail !== null && !g2.mail.includes("Pedido mayor al stock"));
    const g3 = await cotizarMail([2, 2]);
    check("g) dos lineas del mismo sku (2+2 > 3): marca", g3.ok && g3.mail?.includes(STOCK) === true);
    check("g) la marca de stock no depende de la de recargo (cantidad 3 < 10 lleva recargo)", g2.mail?.includes("con recargo del proveedor") === true);
    // Carrito viejo: la tienda ahora recorta la cantidad al stock, pero un
    // borrador guardado ayer puede superar el stock de hoy. El server NO
    // rechaza (es una cotizacion) y el mail lo marca: es la red de seguridad.
    const gViejo = await cotizarMail([50]);
    const qViejo = await prisma.quote.findFirst({ where: { id: { in: creadas } }, orderBy: { createdAt: "desc" }, include: { items: true } });
    check("g) carrito viejo (50 vs stock 3): el server lo acepta y guarda la cantidad pedida", gViejo.ok && qViejo?.items[0]?.quantity === 50, `qty=${qViejo?.items[0]?.quantity}`);
    check("g) carrito viejo (50 vs stock 3): el mail lo marca con el stock de hoy", gViejo.mail?.includes(STOCK) === true);
    await prisma.productVariant.update({ where: { id: varianteId }, data: { stock: 0, reservedStock: 0 } });
    const gCero = await cotizarMail([1]);
    check("g) variante agotada hoy (stock 0) con una linea vieja: se acepta y el mail dice (stock: 0)", gCero.ok && gCero.mail?.includes("Pedido mayor al stock del último sync (stock: 0)") === true);
    await prisma.productVariant.update({ where: { id: varianteId }, data: { stock: 5, reservedStock: 2 } });
    const rCliente = await submitQuote(formulario([{ productId: vivo.id, variantSku: sku, quantity: 1 }]));
    if (rCliente.quoteId) creadas.push(rCliente.quoteId);
    check("g) el cliente no ve nada nuevo: el resultado de submitQuote no trae datos de stock", Object.keys(rCliente).every((k) => !/stock/i.test(k)));

    console.log("\n=========== HELPERS PUROS ===========");
    const disp = new Map([["A", 3], ["B", 0]]);
    const h = lineasSobreElStock(
      [
        { variantSku: "A", quantity: 4 }, // 4 > 3
        { variantSku: "A", quantity: 3 }, // hay 3 -> pero A suma 7
        { variantSku: "B", quantity: 1 }, // stock 0
        { variantSku: "Z", quantity: 99 }, // sku que no figura: sin marca
        { variantSku: null, quantity: 99 }, // sin sku: sin marca
      ],
      disp
    );
    check("h) suma por sku y devuelve el disponible", h[0] === 3 && h[1] === 3, JSON.stringify(h));
    check("h) stock 0 con pedido > 0 se marca con 0", h[2] === 0, JSON.stringify(h));
    check("h) sku ausente del mapa o null: sin marca", h[3] === null && h[4] === null, JSON.stringify(h));
    check(
      "h) justo en el stock: sin marca",
      lineasSobreElStock([{ variantSku: "A", quantity: 3 }], disp)[0] === null
    );

    check("h) estados cerrados: ACCEPTED, REJECTED y EXPIRED ocultan la marca en vivo; DRAFT, SUBMITTED y QUOTED no",
      Object.values(QuoteStatus).filter(esCotizacionCerrada).sort().join(",") === "ACCEPTED,EXPIRED,REJECTED");
    check("h) cantidadRestante nunca es negativa (carrito viejo que ya supera el stock)", cantidadRestante(3, 50) === 0 && cantidadRestante(3, 1) === 2);

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
    await restaurar("stock de la variante de prueba", () =>
      prisma.productVariant.update({ where: { id: vivo.variants[0].id }, data: stockOriginal })
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

// Verificacion de la auditoria (hallazgo 1). Script temporal de la rama:
// prueba las acciones publicas de /cotizar contra la base LOCAL.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { POLITICA_PRIVACIDAD_VERSION } from "../src/lib/privacidad";
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
    where: { active: true, deletedAt: null, variants: { some: {} } },
    include: { variants: { take: 1 } },
    orderBy: { name: "asc" },
  });
  if (!vivo) throw new Error("no hay producto vivo con variantes");
  const pausado = await prisma.product.findFirst({
    where: { active: true, deletedAt: null, variants: { some: {} }, id: { not: vivo.id } },
    include: { variants: { take: 1 } },
    orderBy: { name: "desc" },
  });
  if (!pausado) throw new Error("no hay segundo producto");

  // Pausar el segundo para el test (se restaura al final).
  await prisma.product.update({ where: { id: pausado.id }, data: { active: false } });

  try {
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
  } finally {
    await prisma.product.update({ where: { id: pausado.id }, data: { active: true } });
    console.log("[restore] producto restaurado a active=true");
  }
}

main().finally(() => prisma.$disconnect());

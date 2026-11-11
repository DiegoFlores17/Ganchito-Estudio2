// Verificacion de la tanda 4c (ficha con tarjetas por cantidad), contra la
// base LOCAL. Toca el umbral de un producto y lo restaura en el finally; no
// crea cotizaciones.
//
// La parte del payload RSC necesita la tienda corriendo en local:
//   npx next start -p 3100   (en otra terminal)
//   BASE=http://localhost:3100 npx tsx scripts/audit-verify-ficha.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getPricingConfig } from "../src/lib/pricing";
import { getProductById } from "../src/lib/product";
import { fichaDeImpresion } from "../src/lib/impresion-producto";
import { centavosDeImpresion, tituloDelTotal } from "../src/lib/quote-printing";
import { formatPriceArsCentavos } from "../src/lib/format";
import { getQuoteItemsSummary } from "../src/app/(store)/cotizar/actions";
import { tarjetasDeLaFicha, totalDeLaFicha } from "../src/app/(store)/producto/[id]/actions";
import { lineasPorAgregar } from "../src/lib/quote-cart";
import { leyendasDePrecio, LEYENDAS_PRECIO } from "../src/lib/leyendas-precio";

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

/// Lo que no puede viajar al navegador: costos crudos, el umbral, la etiqueta
/// de Zecat. El MONTO del adicional (137.750) si puede.
function prohibidos(texto: string, umbral: number): string[] {
  const hallados: string[] = [];
  for (const x of ["95000", "95.000", "minOrderQuantity", "printingUnderMinimumCost", "unitCost", "setupCost", "levelLabel", "printingLevels", "zecatAreaIds"]) {
    if (texto.includes(x)) hallados.push(x);
  }
  if (/\b\d+KP\b/.test(texto)) hallados.push("KP");
  if (new RegExp(`"desde":${umbral}[,}]`).test(texto)) hallados.push(`tarjeta en ${umbral}`);
  return hallados;
}

/// Total de /cotizar para estas lineas, sumado como lo suma la pantalla:
/// subtotales de producto + `centavosDeImpresion` de la opcion elegida.
async function totalDeCotizar(
  productId: string,
  lineas: Array<{ variantSku: string; quantity: number }>,
  seleccion?: unknown
) {
  const r = await getQuoteItemsSummary(
    lineas.map((l) => ({ productId, ...l })),
    seleccion === undefined ? undefined : { [productId]: seleccion }
  );
  const p = r.printing.find((x) => x.productId === productId)!;
  const o = p.opciones.find((x) => x.key === p.seleccion);
  const centavos =
    r.items.reduce((s, i) => s + i.subtotalCentavos, 0) +
    (o ? centavosDeImpresion(o, p.quantity, p.surcharge).total : 0);
  return { total: formatPriceArsCentavos(centavos / 100), adicional: o ? p.surcharge : null };
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("localhost")) throw new Error("ABORTADO: DATABASE_URL no apunta a localhost.");

  const config = await getPricingConfig();
  const fila = await prisma.product.findFirst({
    where: { zecatId: "4048", active: true, deletedAt: null },
    select: { id: true, minOrderQuantity: true },
  });
  if (!fila) throw new Error("FIXTURE: falta el 4048 (Chaleco Pampero) activo en local");
  const minimoOriginal = fila.minOrderQuantity;

  try {
    // ---------- 1. Tarjetas ----------
    const p = (await getProductById(fila.id))!;
    const sku = p.variants.find((v) => v.stock - v.reservedStock > 0)!.sku;
    const umbral = p.minOrderQuantity ?? 0;
    const ficha = fichaDeImpresion(p, config)!;
    const tarjetas = ficha.tarjetasPorSku[sku];
    check("4048 tiene tarjetas", tarjetas.length > 0, tarjetas.map((t) => t.desde).join(","));
    check(`ninguna tarjeta en el umbral (${umbral})`, tarjetas.every((t) => t.desde !== umbral));
    check("debajo del umbral la tarjeta lleva el adicional; en o arriba no", tarjetas.every((t) => (t.desde < umbral) === (t.adicional !== null)));
    check("tarjetas sin KP", JSON.stringify(ficha).match(/\d+KP/) === null, ficha.sizeLabel);

    // Umbral que COINCIDE con un escalon (15): esa tarjeta tiene que faltar.
    await prisma.product.update({ where: { id: fila.id }, data: { minOrderQuantity: 15 } });
    const p15 = (await getProductById(fila.id))!;
    const t15 = fichaDeImpresion(p15, config)!.tarjetasPorSku[sku];
    check("umbral en un escalon (15): no hay tarjeta de 15", !t15.some((t) => t.desde === 15), t15.map((t) => t.desde).join(","));
    check("umbral 15: la de 2 lleva adicional y la de 30 no", t15.find((t) => t.desde === 2)?.adicional !== null && t15.find((t) => t.desde === 30)?.adicional === null);
    await prisma.product.update({ where: { id: fila.id }, data: { minOrderQuantity: minimoOriginal } });

    // Unitario x cantidad = total, a la vista.
    const num = (s: string) => Math.round(Number(s.replace(/[^\d,]/g, "").replace(",", ".")) * 100);
    check("cada tarjeta: unitario x cantidad = total mostrado", tarjetas.every((t) => formatPriceArsCentavos((num(t.unitario) * t.desde) / 100) === t.total));

    // ---------- 2. Ficha = /cotizar ----------
    for (const q of [1, umbral - 1, umbral, umbral + 6, 30, 42]) {
      if (q < 1) continue;
      const lineas = [{ variantSku: sku, quantity: q }];
      const d = await totalDeLaFicha(fila.id, lineas);
      const c = (await totalDeCotizar(fila.id, lineas)).total;
      check(`cantidad ${q}: total de la ficha = total de /cotizar`, d?.total === c, `${d?.total} / ${c}`);
      check(`cantidad ${q}: adicional solo debajo del umbral`, (q < umbral) === (d?.adicional !== null), String(d?.adicional));
      // La tarjeta del escalon (si hay una justo en q) + preparacion + adicional = total.
      const t = tarjetas.find((x) => x.desde === q);
      if (t && d) {
        const suma = num(t.total) + num(ficha.preparacion) + (t.adicional ? num(t.adicional) : 0);
        check(`cantidad ${q}: tarjeta + preparacion + adicional = total de la ficha`, formatPriceArsCentavos(suma / 100) === d.total);
      }
      const hallados = prohibidos(JSON.stringify(d), umbral);
      check(`cantidad ${q}: respuesta de la action sin datos prohibidos`, hallados.length === 0, hallados.join(","));
    }
    const ninguna = await totalDeLaFicha(fila.id, [{ variantSku: sku, quantity: 3 }], "ninguna");
    check("'ninguna': sin personalizacion ni adicional", ninguna?.personalizacion === null && ninguna?.adicional === null);

    // ---------- 4. Tarjeta activa: su adicional sale del total ----------
    // La activa se elige por escalon del total del producto; su linea de
    // adicional es la del total que devuelve el servidor (regla del panel:
    // activa ? desglose.adicional : t.adicional). Con 12 unidades la activa es
    // la de 2 (que a SU cantidad lleva adicional), pero el total no.
    const d12 = await totalDeLaFicha(fila.id, [{ variantSku: sku, quantity: 12 }]);
    const activa12 = [...tarjetas].reverse().find((t) => 12 >= t.desde)!;
    check("12 u.: la activa es la de 2 y a su cantidad lleva adicional", activa12.desde === 2 && activa12.adicional !== null);
    check("12 u.: el total no trae adicional -> la activa tampoco lo muestra", d12?.adicional === null);
    const d1 = await totalDeLaFicha(fila.id, [{ variantSku: sku, quantity: 1 }]);
    check("1 u.: total con adicional = adicional de la tarjeta activa", d1?.adicional === tarjetas[0].adicional, `${d1?.adicional} / ${tarjetas[0].adicional}`);

    // ---------- 5. Carrito + lo que se agrega ----------
    const conCarrito = await totalDeLaFicha(fila.id, [{ variantSku: sku, quantity: 1 }], undefined, { [sku]: 10 });
    const cot11 = await totalDeCotizar(fila.id, [{ variantSku: sku, quantity: 10 }, { variantSku: sku, quantity: 1 }]);
    check("10 en el carrito + 1: '11 unidades (10 ya en tu cotización)'", conCarrito?.cantidad === 11 && conCarrito?.enCotizacion === 10);
    check("10 en el carrito + 1: sin adicional, igual que /cotizar", conCarrito?.adicional === null && cot11.adicional === null);
    check("10 en el carrito + 1: total = /cotizar", conCarrito?.total === cot11.total, `${conCarrito?.total} / ${cot11.total}`);
    const soloUno = await totalDeLaFicha(fila.id, [{ variantSku: sku, quantity: 1 }]);
    check("sin carrito, 1 sola unidad SI lleva adicional (el carrito cambia la decision)", soloUno?.adicional !== null);

    // ---------- 6. Recuadro = boton ----------
    const combos = [{ sku: "A", quantity: 10 }, { sku: "B", quantity: 3 }];
    const conVar = lineasPorAgregar({ conVariantes: true, combinaciones: combos, sku: "A", cantidad: 1, cupo: 50 });
    check("con talles: se agregan las combinaciones, no el selector", JSON.stringify(conVar) === JSON.stringify([{ variantSku: "A", quantity: 10 }, { variantSku: "B", quantity: 3 }]));
    check("con talles y sin combinaciones: no se agrega nada", lineasPorAgregar({ conVariantes: true, combinaciones: [], sku: "A", cantidad: 7, cupo: 50 }).length === 0);
    check("sin talles: el selector, topeado al cupo", JSON.stringify(lineasPorAgregar({ conVariantes: false, combinaciones: [], sku: "A", cantidad: 9, cupo: 4 })) === JSON.stringify([{ variantSku: "A", quantity: 4 }]));
    // El recuadro tras "+ Agregar combinacion" de 10 (selector vuelto a 1):
    // suma las MISMAS lineas que el boton -> 10, no 11.
    const tras = await totalDeLaFicha(fila.id, lineasPorAgregar({ conVariantes: true, combinaciones: [{ sku, quantity: 10 }], sku, cantidad: 1, cupo: 50 }));
    check("tras agregar una combinacion de 10: el recuadro cuenta 10, no 11", tras?.cantidad === 10, String(tras?.cantidad));

    // ---------- 6b. Vista previa (nada armado todavia) ----------
    // Sin combinaciones, el panel consulta la variante y la cantidad del
    // selector: el recuadro aparece antes de agregar nada, con su titulo.
    const sinArmar = lineasPorAgregar({ conVariantes: true, combinaciones: [], sku, cantidad: 5, cupo: 50 });
    const consultaPrevia = sinArmar.length > 0 ? sinArmar : [{ variantSku: sku, quantity: 5 }];
    const previa = await totalDeLaFicha(fila.id, consultaPrevia);
    check("vista previa: hay total antes de agregar nada", previa !== null && previa.cantidad === 5);
    check("vista previa: 'si llevás 5 unidades'", previa !== null && tituloDelTotal(previa, true) === "Tu total estimado · si llevás 5 unidades", previa ? tituloDelTotal(previa, true) : "");
    check("vista previa: total = /cotizar", previa?.total === (await totalDeCotizar(fila.id, consultaPrevia)).total);
    const previaCarrito = await totalDeLaFicha(fila.id, consultaPrevia, undefined, { [sku]: 10 });
    check("vista previa con carrito: lo dice el titulo", previaCarrito !== null && tituloDelTotal(previaCarrito, true) === "Tu total estimado · si llevás 5 unidades (más 10 ya en tu cotización)", previaCarrito ? tituloDelTotal(previaCarrito, true) : "");
    check("con combinaciones: titulo sin 'si llevás'", tituloDelTotal({ cantidad: 11, enCotizacion: 10 }, false) === "Tu total estimado · 11 unidades (10 ya en tu cotización)");
    check("nunca se mezclan: con combinaciones se consultan SOLO ellas", lineasPorAgregar({ conVariantes: true, combinaciones: [{ sku, quantity: 10 }], sku, cantidad: 7, cupo: 50 }).reduce((n, l) => n + l.quantity, 0) === 10);

    // ---------- 6c. Variante desactivada en el carrito ----------
    // El servidor la descarta: la cantidad que valua (11) difiere de la que
    // cuenta el navegador (16). El recuadro tiene que aparecer igual, con la
    // cantidad del servidor (la vigencia es por pedido, no por cantidad).
    const otra = p.variants.find((v) => v.sku !== sku)!.sku;
    await prisma.productVariant.update({ where: { sku: otra }, data: { active: false } });
    try {
      const conMuerta = await totalDeLaFicha(fila.id, [{ variantSku: sku, quantity: 1 }], undefined, { [otra]: 5, [sku]: 10 });
      const cotViva = await totalDeCotizar(fila.id, [{ variantSku: sku, quantity: 10 }, { variantSku: sku, quantity: 1 }]);
      check("variante desactivada en el carrito: igual hay total", conMuerta !== null);
      check("variante desactivada: el servidor valua 11 (10 ya en tu cotización), no 16", conMuerta?.cantidad === 11 && conMuerta?.enCotizacion === 10, `${conMuerta?.cantidad} / ${conMuerta?.enCotizacion}`);
      check("variante desactivada: total = /cotizar con lo que sigue vivo", conMuerta?.total === cotViva.total, `${conMuerta?.total} / ${cotViva.total}`);
      check("variante desactivada: el navegador cuenta 16 -> corresponde la nota", 5 + 10 + 1 !== conMuerta?.cantidad);
    } finally {
      await prisma.productVariant.update({ where: { sku: otra }, data: { active: true } });
    }

    // ---------- 7. Seleccion guardada ----------
    const opciones = (await getQuoteItemsSummary([{ productId: fila.id, variantSku: sku, quantity: 1 }])).printing[0].opciones;
    const grande = opciones[opciones.length - 1];
    const sel = { zecatTypeId: grande.zecatTypeId, zecatAreaId: grande.zecatAreaId };
    const g = await tarjetasDeLaFicha(fila.id, sel);
    check("guardada: la action devuelve tarjetas con ESE tamano", g !== null && !g.sinPersonalizar && g.impresion.sizeLabel === grande.sizeLabel, g && !g.sinPersonalizar ? g.impresion.sizeLabel : String(g));
    if (g && !g.sinPersonalizar) {
      for (const t of g.impresion.tarjetasPorSku[sku].filter((x) => x.desde >= umbral)) {
        const dt = await totalDeLaFicha(fila.id, [{ variantSku: sku, quantity: t.desde }], sel);
        const ct = await totalDeCotizar(fila.id, [{ variantSku: sku, quantity: t.desde }], sel);
        const suma = num(t.total) + num(g.impresion.preparacion);
        check(`guardada, ${t.desde} u.: tarjeta + preparacion = total ficha = /cotizar`, formatPriceArsCentavos(suma / 100) === dt?.total && dt?.total === ct.total, `${formatPriceArsCentavos(suma / 100)} / ${dt?.total} / ${ct.total}`);
      }
      const hallados = prohibidos(JSON.stringify(g), umbral);
      check("guardada: respuesta sin datos prohibidos", hallados.length === 0, hallados.join(","));
    }
    const sp = await tarjetasDeLaFicha(fila.id, "ninguna");
    check("guardada 'Sin personalizar': la action lo dice", sp !== null && sp.sinPersonalizar === true);
    check("guardada invalida: quedan las de la pagina (null)", (await tarjetasDeLaFicha(fila.id, { zecatTypeId: "x", zecatAreaId: "y" })) === null);

    // ---------- 8. Leyendas ----------
    const conNiv = leyendasDePrecio({ personalizable: true, conNiveles: true });
    const sinNiv = leyendasDePrecio({ personalizable: true });
    check("con niveles: la ficha ya no dice 'se cotizan aparte' la personalizacion", conNiv.ficha === LEYENDAS_PRECIO.ficha.conImpresion && /personalización estimada · el envío se cotiza aparte/.test(conNiv.ficha));
    check("con niveles: el pie de impresion dice estimado y se confirma con el logo", conNiv.impresion === LEYENDAS_PRECIO.impresionConNiveles && /estimado/.test(conNiv.impresion));
    check("CDO / sin niveles: leyendas de siempre", sinNiv.ficha === LEYENDAS_PRECIO.ficha.personalizable && sinNiv.impresion === LEYENDAS_PRECIO.impresion);

    // CDO: sin tarjetas y sin total de personalizacion.
    const cdo = await prisma.product.findFirst({
      where: { origin: "CDO", active: true, deletedAt: null, variants: { some: { active: true } } },
      select: { id: true },
    });
    if (cdo) {
      const pc = (await getProductById(cdo.id))!;
      check("CDO: sin tarjetas", fichaDeImpresion(pc, config) === null);
      check("CDO: la action devuelve null", (await totalDeLaFicha(cdo.id, [{ variantSku: pc.variants[0].sku, quantity: 2 }])) === null);
    }

    // ---------- 3. Payload RSC de la ficha ----------
    const base = process.env.BASE;
    if (!base) {
      check("BASE definido para leer el payload RSC", false, "correr con BASE=http://localhost:3100");
    } else {
      for (const ruta of [`/producto/${fila.id}`]) {
        const html = await (await fetch(`${base}${ruta}`)).text();
        const rsc = await (await fetch(`${base}${ruta}`, { headers: { RSC: "1" } })).text();
        check(`${ruta}: la pagina trae las tarjetas`, html.includes("tarjetasPorSku") || rsc.includes("tarjetasPorSku"));
        for (const [nombre, texto] of [["HTML", html], ["RSC", rsc]] as const) {
          const hallados = prohibidos(texto, umbral);
          check(`${ruta} ${nombre}: sin datos prohibidos`, hallados.length === 0, hallados.join(","));
        }
      }
    }
  } finally {
    await prisma.product.update({ where: { id: fila.id }, data: { minOrderQuantity: minimoOriginal } });
    console.log(`[restore] umbral del 4048 restaurado a ${minimoOriginal}`);
    await prisma.$disconnect();
  }

  console.log(fallos === 0 ? "\nTodos los chequeos pasan." : `\n${fallos} chequeo(s) FALLAN.`);
  if (fallos > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Verificacion de los destacados automaticos de la home (rango de precio
// editable + una por categoria + rotacion diaria).
//
//   npx tsx scripts/audit-verify-destacados.ts
//
// Las partes puras no tocan la base. Las de paridad con la tienda y de cache
// corren contra la base local y solo LEEN, salvo featured_config: la paridad
// guarda ahi cada rango que prueba y al final deja la fila como estaba. El
// script aborta si DATABASE_URL no apunta a localhost.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Currency, Prisma } from "@prisma/client";

// --- Guarda: solo localhost --------------------------------------------------
const destino = new URL(process.env.DATABASE_URL ?? "postgres://x").hostname;
if (destino !== "localhost" && destino !== "127.0.0.1") {
  console.error(`ABORTADO: DATABASE_URL apunta a ${destino}, no a localhost.`);
  process.exit(1);
}

// La cache real (unstable_cache) no existe fuera de Next: sustituto en memoria.
globalThis.__ganchitoCacheShim = { entradas: new Map(), fallos: 0, aciertos: 0 };
const registro: string[][] = [];
globalThis.__ganchitoCacheRecorder = registro;

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

const D = (n: number | string) => new Prisma.Decimal(n);

async function main() {
  const {
    claveDeColor,
    contarColores,
    TOPE_COLORES,
    claveDeRotacion,
    fechaArt,
    elegirDestacados,
    parsearPesosEnteros,
  } = await import("../src/lib/destacados");
  type Candidato = import("../src/lib/destacados").CandidatoDestacable;
  type Variante = import("../src/lib/destacados").VarianteDestacable;

  // =========================================================================
  console.log("\n=========== A. CLAVE DE COLOR ===========");
  // =========================================================================
  check("'Beige / Kaki / Beige / kaki' -> 'beige / kaki'", claveDeColor("Beige / Kaki / Beige / kaki") === "beige / kaki", String(claveDeColor("Beige / Kaki / Beige / kaki")));
  check("'Azul Mar / . / Clip Blanco' -> 'azul mar / clip blanco'", claveDeColor("Azul Mar / . / Clip Blanco") === "azul mar / clip blanco");
  check("'Negro / Naranja' != 'Naranja / Negro' (no se ordena)", claveDeColor("Negro / Naranja") !== claveDeColor("Naranja / Negro") && claveDeColor("Negro / Naranja") === "negro / naranja");
  check("null, '' y ' . ' -> null", claveDeColor(null) === null && claveDeColor("") === null && claveDeColor(" . ") === null);
  check("acentos y mayusculas colapsan ('Verde Lima' = 'verde  LIMA')", claveDeColor("Verde Lima") === claveDeColor("verde  LIMA"));
  check("no mezcla sinonimos ('Azul Francia' != 'Azul')", claveDeColor("Azul Francia") !== claveDeColor("Azul"));

  // =========================================================================
  console.log("\n=========== B. CONTEO DE COLORES ===========");
  // =========================================================================
  const v = (colorName: string | null, stock = 5, reservedStock = 0, costPrice: number | string = 10000, discountPercent: number | null = null): Variante => ({
    colorName,
    stock,
    reservedStock,
    costPrice: D(costPrice),
    discountPercent: discountPercent === null ? null : D(discountPercent),
  });
  check("el mismo color en varios talles cuenta 1", contarColores([v("Rojo"), v("Rojo"), v("rojo")]) === 1);
  check("una variante sin stock disponible no cuenta", contarColores([v("Rojo"), v("Azul", 3, 3), v("Verde", 0, 0)]) === 1);
  check("stock reservado mayor al bruto no cuenta (negativo)", contarColores([v("Rojo", 1, 4)]) === 0);
  check("colorName null o sin letras cuenta 0", contarColores([v(null), v("."), v("")]) === 0);
  check("combinaciones distintas son colores distintos", contarColores([v("Negro / Naranja"), v("Naranja / Negro"), v("Negro / Naranja")]) === 2);
  check("TOPE_COLORES = 6", TOPE_COLORES === 6);

  // =========================================================================
  console.log("\n=========== C. FECHA ART ===========");
  // =========================================================================
  // 23:30 ART del 5/10 = 02:30Z del 6/10; 00:30 ART del 6/10 = 03:30Z del 6/10.
  check("23:30 ART sigue siendo el dia anterior (02:30Z)", fechaArt(new Date("2026-10-06T02:30:00Z")) === "2026-10-05", fechaArt(new Date("2026-10-06T02:30:00Z")));
  check("00:30 ART ya es el dia nuevo (03:30Z)", fechaArt(new Date("2026-10-06T03:30:00Z")) === "2026-10-06", fechaArt(new Date("2026-10-06T03:30:00Z")));
  check("el limite exacto es 03:00Z", fechaArt(new Date("2026-10-06T02:59:59Z")) === "2026-10-05" && fechaArt(new Date("2026-10-06T03:00:00Z")) === "2026-10-06");
  check("formato YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(fechaArt(new Date())));

  // =========================================================================
  console.log("\n=========== C2. PARSEO DEL RANGO ===========");
  // =========================================================================
  for (const [crudo, esperado] of [
    ["5000", 5000],
    ["5.000", 5000],
    ["5.000,00", 5000],
    ["5000,0", 5000],
    [" 15.000 ", 15000],
    ["0", 0],
    ["1.234.567", 1234567],
  ] as const) {
    check(`'${crudo}' -> ${esperado}`, parsearPesosEnteros(crudo) === esperado, String(parsearPesosEnteros(crudo)));
  }
  for (const crudo of ["", "  ", "1e3", "0x10", "-5000", "+5000", "5000,50", "5.000,5", "5000.50", "5,5", "5.00", "50.00.000", "abc", "Infinity", "5 000", "1.000.000.001"]) {
    check(`'${crudo}' se rechaza`, parsearPesosEnteros(crudo) === null, String(parsearPesosEnteros(crudo)));
  }

  // =========================================================================
  console.log("\n=========== D. ELECCION ===========");
  // =========================================================================
  const pricing = { defaultMarginPercent: D(45), usdRate: D(1500) };
  /// Costo 10000 ARS -> 14500 de venta (en rango 5000-15000).
  const EN_RANGO = 10000;
  /// Costo 2000 -> 2900 (debajo del rango). Costo 20000 -> 29000 (arriba).
  const BAJO = 2000;
  const ALTO = 20000;
  const colores = (n: number, costo: number = EN_RANGO): Variante[] =>
    Array.from({ length: n }, (_, i) => v(`Color ${i}`, 5, 0, costo));
  const cand = (id: string, grupo: string, variants: Variante[], currency: Currency = Currency.ARS): Candidato => ({ id, grupo, variants, currency });
  const base = { priceMin: 5000, priceMax: 15000, fecha: "2026-10-06", cantidad: 8, pricing };
  const ids = (r: { elegidos: Array<{ id: string }> }) => r.elegidos.map((e) => e.id);

  // Tope de 6: 12 colores y 6 colores empatan; decide la rotacion.
  const fechaX = "2026-10-06";
  const doce = cand("p-doce", "g1", colores(12));
  const seis = cand("p-seis", "g2", colores(6));
  const cinco = cand("p-cinco", "g3", colores(5));
  const siete = cand("p-siete", "g4", colores(7));
  const rXY = elegirDestacados([doce, seis, cinco, siete], { ...base, fecha: fechaX });
  const esperadoEmpate = ["p-doce", "p-seis", "p-siete"].sort((a, b) => claveDeRotacion(a, fechaX).localeCompare(claveDeRotacion(b, fechaX)));
  check("12, 7 y 6 colores empatan: el orden lo decide la rotacion", ids(rXY).slice(0, 3).join() === esperadoEmpate.join(), ids(rXY).join());
  check("5 colores va despues de los que topean en 6", ids(rXY)[3] === "p-cinco", ids(rXY).join());
  const chicos = elegirDestacados([cand("a", "g1", colores(2)), cand("b", "g2", colores(5)), cand("c", "g3", colores(3))], base);
  check("por debajo del tope manda la cantidad de colores (5 > 3 > 2)", ids(chicos).join() === "b,c,a", ids(chicos).join());
  check("el resultado informa los colores contados (sin tope)", rXY.elegidos.find((e) => e.id === "p-doce")?.colores === 12 && rXY.elegidos.find((e) => e.id === "p-cinco")?.colores === 5);

  // Rotacion por fecha.
  const empatados = Array.from({ length: 6 }, (_, i) => cand(`t-${i}`, `g${i}`, colores(6)));
  const f1 = ids(elegirDestacados(empatados, { ...base, fecha: "2026-10-06" }));
  const f1b = ids(elegirDestacados([...empatados].reverse(), { ...base, fecha: "2026-10-06" }));
  const f2 = ids(elegirDestacados(empatados, { ...base, fecha: "2026-10-07" }));
  const f3 = ids(elegirDestacados(empatados, { ...base, fecha: "2026-10-08" }));
  check("misma fecha, mismo orden (aunque entren en otro orden)", f1.join() === f1b.join(), f1.join());
  check("otra fecha cambia el orden entre empatados", f1.join() !== f2.join() || f2.join() !== f3.join(), `${f1.join()} | ${f2.join()} | ${f3.join()}`);
  check("la rotacion es md5 de id+fecha (hex de 32)", /^[0-9a-f]{32}$/.test(claveDeRotacion("x", "2026-10-06")) && claveDeRotacion("x", "2026-10-06") !== claveDeRotacion("x", "2026-10-07"));

  // Una por categoria (grupo canonico).
  const mismaCat = elegirDestacados(
    [cand("a1", "gA", colores(6)), cand("a2", "gA", colores(5)), cand("a3", "gA", colores(4)), cand("b1", "gB", colores(1))],
    { ...base, cantidad: 2 }
  );
  check("una por categoria: con cantidad 2 salen una de gA (la mejor) y la de gB", ids(mismaCat).join() === "a1,b1", ids(mismaCat).join());
  check("etapa 'rango' en ambas", mismaCat.elegidos.every((e) => e.etapa === "rango"));

  // Relleno 2: fuera de rango, sigue siendo una por categoria y solo categorias no usadas.
  const conRelleno = elegirDestacados(
    [
      cand("r1", "gA", colores(3)),
      cand("r1b", "gA", colores(2, BAJO)), // gA ya usada: no entra en etapa 2
      cand("f1", "gB", colores(4, BAJO)),
      cand("f2", "gB", colores(2, ALTO)), // gB: solo uno
      cand("f3", "gC", colores(1, ALTO)),
    ],
    { ...base, cantidad: 3 }
  );
  check("relleno de precio: primero el del rango, despues fuera de rango de categorias no usadas", ids(conRelleno).join() === "r1,f1,f3", ids(conRelleno).join());
  check("etapas: rango, relleno-precio, relleno-precio", conRelleno.elegidos.map((e) => e.etapa).join() === "rango,relleno-precio,relleno-precio", conRelleno.elegidos.map((e) => e.etapa).join());

  // Relleno 3: repite categoria.
  const repite = elegirDestacados(
    [cand("x1", "gA", colores(4)), cand("x2", "gA", colores(3)), cand("x3", "gA", colores(2, BAJO))],
    { ...base, cantidad: 3 }
  );
  check("repite categoria solo cuando no queda otra, en orden de score", ids(repite).join() === "x1,x2,x3" && repite.elegidos.map((e) => e.etapa).join() === "rango,relleno-categoria,relleno-categoria", `${ids(repite).join()} ${repite.elegidos.map((e) => e.etapa).join()}`);

  // Pool agotado.
  const poco = elegirDestacados([cand("u1", "gA", colores(2)), cand("u2", "gB", colores(1))], base);
  check("pool agotado: devuelve menos de 8 (no inventa)", poco.elegidos.length === 2);
  check("sin candidatos: lista vacia", elegirDestacados([], base).elegidos.length === 0);

  // Stock.
  const sinStock = elegirDestacados([cand("s1", "gA", [v("Rojo", 3, 3)]), cand("s2", "gB", [v("Rojo", 0, 0)]), cand("s3", "gC", [v("Rojo", 4, 0)])], base);
  check("nunca elige un producto sin stock disponible (ni de relleno)", ids(sinStock).join() === "s3", ids(sinStock).join());
  // Sin color pero con stock: elegible, score 0.
  const sinColor = elegirDestacados([cand("n1", "gA", [v(null)])], base);
  check("producto sin color pero con stock es elegible (0 colores)", ids(sinColor).join() === "n1" && sinColor.elegidos[0].colores === 0);

  // Rango inclusivo y precio = piso "Desde" sobre variantes activas.
  const margen100 = { defaultMarginPercent: D(100), usdRate: D(1500) };
  const bordes = elegirDestacados(
    [cand("b-min", "g1", [v("A", 5, 0, 2500)]), cand("b-max", "g2", [v("A", 5, 0, 7500)]), cand("b-fuera", "g3", [v("A", 5, 0, 7501)])],
    { ...base, cantidad: 1, pricing: margen100 }
  );
  check("rango inclusivo: 5000 y 15000 entran", bordes.stats.productosEnRango === 2 && bordes.stats.categoriasEnRango === 2, JSON.stringify(bordes.stats));
  // El precio es el minimo entre variantes (aunque la barata no tenga stock): igual que la card.
  const desde = elegirDestacados([cand("d1", "g1", [v("A", 5, 0, 10000), v("B", 0, 0, 2000)])], base);
  check("precio = piso 'Desde' de la card (incluye variantes activas sin stock)", desde.elegidos[0].etapa === "relleno-precio" && Number(desde.elegidos[0].precio) === 2900, `${desde.elegidos[0].etapa} ${desde.elegidos[0].precio}`);
  // USD se convierte.
  const usd = elegirDestacados([cand("us", "g1", [v("A", 5, 0, 5)], Currency.USD)], base);
  check("USD: 5 USD x 1500 x 1.45 = 10875 (en rango)", Number(usd.elegidos[0].precio) === 10875 && usd.elegidos[0].etapa === "rango", `${usd.elegidos[0].precio}`);
  check("stats: productos y categorias en rango", conRelleno.stats.productosEnRango === 1 && conRelleno.stats.categoriasEnRango === 1, JSON.stringify(conRelleno.stats));

  // Mucho volumen: nunca repite y respeta cantidad.
  const muchos = Array.from({ length: 40 }, (_, i) => cand(`m-${i}`, `g${i % 12}`, colores((i % 9) + 1, i % 3 === 0 ? BAJO : EN_RANGO)));
  const rm = elegirDestacados(muchos, base);
  check("40 candidatos en 12 categorias: 8 distintos", rm.elegidos.length === 8 && new Set(ids(rm)).size === 8);
  check("las primeras 8 son de 8 categorias distintas mientras haya categorias en rango", new Set(rm.elegidos.map((e) => muchos.find((c) => c.id === e.id)!.grupo)).size === 8);

  // El modulo es puro: no importa prisma ni el criterio viejo.
  const fuente = fs.readFileSync(path.join(process.cwd(), "src/lib/destacados.ts"), "utf8");
  check("[estatico] destacados.ts no importa prisma ni usa lastSyncedAt", !/from\s+["']@\/lib\/prisma["']/.test(fuente) && !fuente.includes("lastSyncedAt"));

  // =========================================================================
  console.log("\n=========== E. PARIDAD DE PRECIO CON LA TIENDA (base local, solo lectura) ===========");
  // =========================================================================
  const { prisma } = await import("../src/lib/prisma");
  const { computePriceRange } = await import("../src/lib/pricing");
  const { getProducts, getFeaturedProducts, getFeaturedPreview } = await import("../src/lib/catalog");
  const lectura = await import("../src/lib/lectura-publica");
  const { invalidarCachePublico, TAG } = await import("../src/lib/cache-tags");

  // Solo lee: getPricingConfig() crearia la fila si falta.
  const pricingDb = await prisma.pricingConfig.findUniqueOrThrow({ where: { id: 1 } });

  // La grilla de la tienda, TODAS las paginas, sin filtros: es la poblacion
  // base (activos, no borrados) con las variantes tal como las ve la card.
  async function grillaCompleta(filtro: { priceMin?: number; priceMax?: number } = {}) {
    const todos: Awaited<ReturnType<typeof getProducts>>["products"] = [];
    for (let page = 1; ; page++) {
      const r = await getProducts({ page, ...filtro });
      todos.push(...r.products);
      if (page >= r.totalPages) break;
    }
    return todos;
  }
  const grilla = await grillaCompleta();
  check("hay productos reales en la base local", grilla.length > 50, `${grilla.length} productos`);
  const precioCard = new Map(grilla.map((p) => [p.id, computePriceRange(p.variants, p.currency, pricingDb)?.min ?? null]));

  // Poblacion elegible, calculada por un camino INDEPENDIENTE de la query del
  // lector: categoria visible resuelta en JS, foto principal de la grilla,
  // stock de las variantes de la grilla.
  const categorias = await prisma.category.findMany({ select: { id: true, visible: true, canonicalId: true } });
  const catPorId = new Map(categorias.map((c) => [c.id, c]));
  const productosCat = await prisma.product.findMany({ where: { active: true, deletedAt: null }, select: { id: true, categoryId: true } });
  const catDeProducto = new Map(productosCat.map((p) => [p.id, p.categoryId]));
  function categoriaVisible(productId: string): boolean {
    const c = catPorId.get(catDeProducto.get(productId) ?? "");
    if (!c) return false;
    if (c.canonicalId === null) return c.visible;
    return catPorId.get(c.canonicalId)?.visible === true;
  }
  const elegible = (p: (typeof grilla)[number]) =>
    p.images.length > 0 && categoriaVisible(p.id) && p.variants.some((v) => v.stock - v.reservedStock > 0);
  const poblacion = grilla.filter(elegible);
  check("hay productos elegibles (foto + categoria visible + stock)", poblacion.length > 8, `${poblacion.length}`);

  // El precio con el que el rango evalua a un producto == el de la card.
  const preview = await getFeaturedPreview(5000, "2026-10-06");
  let distintos = 0;
  for (const p of preview.posiciones) {
    const card = precioCard.get(p.id);
    if (!card || !card.equals(p.precio)) distintos++;
  }
  check("el precio del ranking == el 'Desde' de la card, en todos los elegibles", preview.posiciones.length > 8 && distintos === 0, `${preview.posiciones.length} comparados, ${distintos} distintos`);
  check("con take enorme sale todo el universo elegible (sin duplicar)", new Set(preview.posiciones.map((p) => p.id)).size === preview.posiciones.length && preview.posiciones.length === poblacion.length, `${preview.posiciones.length} vs ${poblacion.length} por el camino independiente`);

  // El conjunto en rango == el del filtro de precio del catalogo. El rango se
  // guarda en featured_config igual que desde el panel (la vista previa no
  // acepta otro), y al terminar la fila vuelve a como estaba.
  const configPrevia = await prisma.featuredConfig.findUnique({ where: { id: 1 } });
  for (const [A, B] of [[5000, 15000], [3000, 8000], [20000, 40000], [1000, 2500]] as const) {
    await prisma.featuredConfig.upsert({
      where: { id: 1 },
      update: { priceMin: A, priceMax: B },
      create: { id: 1, priceMin: A, priceMax: B },
    });
    const porCard = new Set(grilla.filter((p) => { const x = precioCard.get(p.id); return x && x.greaterThanOrEqualTo(A) && x.lessThanOrEqualTo(B); }).map((p) => p.id));
    const porFiltro = new Set((await grillaCompleta({ priceMin: A, priceMax: B })).map((p) => p.id));
    const soloCard = [...porCard].filter((id) => !porFiltro.has(id));
    const soloFiltro = [...porFiltro].filter((id) => !porCard.has(id));
    check(`[${A}-${B}] precio de la card en rango == filtro de precio del catalogo (misma poblacion: activos)`, soloCard.length === 0 && soloFiltro.length === 0, `${porCard.size} productos; solo card ${soloCard.length}, solo filtro ${soloFiltro.length}`);

    const enRangoElegibles = poblacion.filter((p) => porFiltro.has(p.id));
    const pv = await getFeaturedPreview(8, "2026-10-06");
    check(`[${A}-${B}] stats.productosEnRango == filtro del catalogo ∩ elegibles`, pv.stats.productosEnRango === enRangoElegibles.length, `${pv.stats.productosEnRango} vs ${enRangoElegibles.length}`);
    const grupos = new Set(enRangoElegibles.map((p) => { const c = catPorId.get(catDeProducto.get(p.id)!)!; return c.canonicalId ?? c.id; }));
    check(`[${A}-${B}] stats.categoriasEnRango == categorias canonicas distintas`, pv.stats.categoriasEnRango === grupos.size, `${pv.stats.categoriasEnRango} vs ${grupos.size}`);
    const enRango = pv.posiciones.filter((p) => p.etapa === "rango");
    check(`[${A}-${B}] los marcados 'rango' estan todos dentro del filtro del catalogo`, enRango.every((p) => porFiltro.has(p.id)), `${enRango.length} en rango de ${pv.posiciones.length}`);
  }
  if (configPrevia) {
    await prisma.featuredConfig.update({
      where: { id: 1 },
      data: { priceMin: configPrevia.priceMin, priceMax: configPrevia.priceMax, updatedBy: configPrevia.updatedBy },
    });
  } else {
    await prisma.featuredConfig.delete({ where: { id: 1 } });
  }

  // Una por categoria sobre datos reales (mientras haya categorias en rango).
  const pv8 = await getFeaturedPreview(8, "2026-10-06");
  const gruposDe = (id: string) => { const c = catPorId.get(catDeProducto.get(id)!)!; return c.canonicalId ?? c.id; };
  const etapaRango = pv8.posiciones.filter((p) => p.etapa === "rango");
  check("datos reales: 8 destacados, todos distintos", pv8.posiciones.length === 8 && new Set(pv8.posiciones.map((p) => p.id)).size === 8, `${pv8.posiciones.length}`);
  check("datos reales: los de la etapa 'rango' son de categorias distintas", new Set(etapaRango.map((p) => gruposDe(p.id))).size === etapaRango.length, `${etapaRango.length}`);
  check("datos reales: ninguno sin stock", pv8.posiciones.every((p) => poblacion.some((q) => q.id === p.id)));
  const home = await getFeaturedProducts(8, "2026-10-06");
  check("la home recibe los mismos 8, en el mismo orden, con la forma de siempre (images + variantes activas)", home.map((p) => p.id).join() === pv8.posiciones.map((p) => p.id).join() && home.every((p) => p.images.length === 1 && p.variants.length > 0 && p.variants.every((v) => "costPrice" in v && "discountPercent" in v && "stock" in v && "reservedStock" in v)));

  // =========================================================================
  console.log("\n=========== F. CACHE DEL LECTOR ===========");
  // =========================================================================
  const shim = globalThis.__ganchitoCacheShim!;
  const entradasDestacados = () => [...shim.entradas.entries()].filter(([k]) => k.startsWith("featured-products:"));
  const hoy = fechaArt(new Date());

  const filasAntes = await prisma.featuredConfig.count();
  const h1 = await lectura.getFeaturedProductsPublico(8);
  check("la tienda recibe 8 destacados", h1.length === 8, `${h1.length}`);
  const [[clave1, entrada1]] = entradasDestacados();
  check("tags del lector: store, catalog, pricing, featured", ["store", "catalog", "pricing", "featured"].every((t) => entrada1.tags.includes(t)) && entrada1.tags.length === 4, entrada1.tags.join());
  check("la fecha (hora argentina) es parte de la clave", clave1.includes(hoy), clave1);
  const aciertosAntes = shim.aciertos;
  await lectura.getFeaturedProductsPublico(8);
  check("segunda lectura del mismo dia: de la cache", shim.aciertos === aciertosAntes + 1 && entradasDestacados().length === 1);
  check("la lectura de la tienda no creo la fila de FeaturedConfig", (await prisma.featuredConfig.count()) === filasAntes, `${filasAntes} filas antes y despues`);

  // Otro dia = otra entrada (la rotacion ocurre sola, sin invalidar).
  const RealDate = Date;
  const fijar = (iso: string) => {
    const t = new RealDate(iso).getTime();
    class Falsa extends RealDate {
      constructor(...a: unknown[]) {
        if (a.length === 0) super(t);
        else super(...(a as [string]));
      }
      static now() { return t; }
    }
    globalThis.Date = Falsa as unknown as DateConstructor;
  };
  try {
    fijar("2026-10-06T15:00:00Z");
    const fallosAntes = shim.fallos;
    await lectura.getFeaturedProductsPublico(8);
    fijar("2026-10-07T15:00:00Z");
    await lectura.getFeaturedProductsPublico(8);
    check("al cambiar el dia (ART) la lectura es otra entrada, no un acierto", shim.fallos === fallosAntes + 2 && entradasDestacados().some(([k]) => k.includes("2026-10-06")) && entradasDestacados().some(([k]) => k.includes("2026-10-07")));
    fijar("2026-10-07T01:00:00Z"); // 22:00 ART del 6: sigue siendo el 6 en la tienda
    const fallosMedio = shim.fallos;
    await lectura.getFeaturedProductsPublico(8);
    check("22:00 ART (01:00Z del 7) sigue usando la clave del dia 6", shim.fallos === fallosMedio);
  } finally {
    globalThis.Date = RealDate;
  }

  // Cada tag invalida la entrada; uno ajeno, no.
  for (const tag of [TAG.catalog, TAG.pricing, TAG.featured, TAG.store]) {
    await lectura.getFeaturedProductsPublico(8);
    const hay = entradasDestacados().some(([k]) => k.includes(hoy));
    invalidarCachePublico([tag]);
    const sigue = entradasDestacados().some(([k]) => k.includes(hoy));
    check(`invalidar '${tag}' saca la entrada de destacados`, hay && !sigue);
  }
  await lectura.getFeaturedProductsPublico(8);
  invalidarCachePublico([TAG.menu, TAG.categories, TAG.site]);
  check("invalidar menu/categories/site NO la toca", entradasDestacados().some(([k]) => k.includes(hoy)));

  // Si falta la fila de precios: no se guarda en la cache (y no se escribe nada).
  invalidarCachePublico([TAG.store]);
  const pricingDelegate = prisma.pricingConfig as unknown as { findUnique: (...a: unknown[]) => Promise<unknown> };
  const findOriginal = pricingDelegate.findUnique;
  try {
    pricingDelegate.findUnique = async () => null;
    const sinFila = await lectura.getFeaturedProductsPublico(8);
    check("sin fila de precios: igual responde (cae al lector original)", sinFila.length === 8);
    check("sin fila de precios: la ausencia NO se guarda en la cache", entradasDestacados().length === 0);
  } finally {
    pricingDelegate.findUnique = findOriginal;
  }

  // =========================================================================
  console.log("\n=========== G. ADMIN (estatico) ===========");
  // =========================================================================
  const raiz = process.cwd();
  const dirAdmin = path.join(raiz, "src/app/admin/(panel)/destacados");
  const acciones = fs.readFileSync(path.join(dirAdmin, "actions.ts"), "utf8");
  const pagina = fs.readFileSync(path.join(dirAdmin, "page.tsx"), "utf8");
  const formulario = fs.readFileSync(path.join(raiz, "src/components/admin/featured-range-form.tsx"), "utf8");
  check("[estatico] la accion y la pagina exigen admin (no super admin)", acciones.includes("await requireAdmin()") && pagina.includes("await requireAdmin()") && !/requireSuperAdmin/.test(acciones + pagina));
  check("[estatico] la accion invalida solo el tag featured", /invalidarCachePublico\(\[TAG\.featured\]\)/.test(acciones));
  check("[estatico] el admin no importa lectura-publica ni cache-publico", !/lectura-publica|cache-publico/.test(acciones + pagina + formulario));
  const layout = fs.readFileSync(path.join(raiz, "src/app/admin/(panel)/layout.tsx"), "utf8");
  const idxLink = layout.indexOf("/admin/destacados");
  const idxSuper = layout.indexOf("...(isSuperAdmin");
  check("[estatico] el link de nav esta fuera del grupo solo super-admin", idxLink > 0 && idxLink < idxSuper);
  check("[estatico] audit-verify-cache.ts cubre la ruta (recorre admin/** completo y lo comprueba)", fs.readFileSync(path.join(raiz, "scripts/audit-verify-cache.ts"), "utf8").includes("/destacados/page.tsx"));
  check("[estatico] la accion parsea con parsearPesosEnteros y rechaza min >= max", /parsearPesosEnteros\(/.test(acciones) && /priceMin >= priceMax/.test(acciones) && !/Number\(/.test(acciones));
  check("[estatico] el formulario no usa inputs 'disabled' (no viajan en el FormData)", !/<input[^>]*disabled/.test(formulario));
  check("[estatico] el formulario no usa type=number ('5.000' llegaria como 5)", !/type="number"/.test(formulario));
  const fuenteHome = fs.readFileSync(path.join(raiz, "src/app/(store)/page.tsx"), "utf8");
  check("[estatico] home y panel usan la MISMA constante FEATURED_PRODUCTS_COUNT", /import \{[^}]*FEATURED_PRODUCTS_COUNT[^}]*\} from "@\/lib\/destacados"/.test(fuenteHome) && /FEATURED_PRODUCTS_COUNT/.test(pagina) && !/const (POSICIONES|FEATURED_PRODUCTS_COUNT) = \d/.test(fuenteHome + pagina));
  check("[estatico] getFeaturedPreview ya no acepta rangoOverride", !fs.readFileSync(path.join(raiz, "src/lib/catalog.ts"), "utf8").includes("rangoOverride"));

  await prisma.$disconnect();

  console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

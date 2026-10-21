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
    combinarConFijados,
    FEATURED_PRODUCTS_COUNT,
  } = await import("../src/lib/destacados");
  type Candidato = import("../src/lib/destacados").CandidatoDestacable;
  type Fijado = import("../src/lib/destacados").ProductoFijado;
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


  // =========================================================================
  console.log("\n=========== D2. FIJADOS A MANO (puro) ===========");
  // =========================================================================
  const fij = (id: string, rank: number, variants: Variante[] = colores(2), over: Partial<Fijado> = {}): Fijado => ({
    id, rank, activo: true, conFoto: true, categoriaVisible: true, grupo: `gF-${id}`, currency: Currency.ARS, variants, ...over,
  });
  const pos = (r: { posiciones: Array<{ posicion: number; id: string }> }) => r.posiciones.map((p) => `${p.posicion}:${p.id}`).join();
  // Seis automaticos con puntajes distintos (6,5,4,3,2,1): el orden es a1..a6.
  const autos = Array.from({ length: 6 }, (_, i) => cand(`a${i + 1}`, `gA${i + 1}`, colores(6 - i)));

  const sinFijos = combinarConFijados(autos, [], base);
  check("sin fijados: igual que elegirDestacados (mismos ids, posiciones 1..6, todos automaticos)", pos(sinFijos) === "1:a1,2:a2,3:a3,4:a4,5:a5,6:a6" && sinFijos.posiciones.every((p) => p.origen === "automatico") && ids({ elegidos: sinFijos.posiciones }) .join() === ids(elegirDestacados(autos, base)).join());

  const dos = combinarConFijados(autos, [fij("P2", 2), fij("P5", 5)], base);
  check("fijados en 2 y 5 conservan su posicion y el automatico llena 1,3,4,6,7,8 en su orden", pos(dos) === "1:a1,2:P2,3:a2,4:a3,5:P5,6:a4,7:a5,8:a6", pos(dos));
  check("los fijados llevan origen 'fijado' y los otros 'automatico' con etapa", dos.posiciones.filter((p) => p.origen === "fijado").map((p) => p.id).join() === "P2,P5" && dos.posiciones.filter((p) => p.origen === "automatico").every((p) => p.etapa === "rango"));
  check("un fijado no tiene etapa del automatico", dos.posiciones.filter((p) => p.origen === "fijado").every((p) => p.etapa === null));

  // El automatico excluye ids fijados aunque sean sus mejores.
  const conMejor = combinarConFijados(autos, [fij("a1", 4)], base);
  check("el automatico excluye los ids fijados (a1 sale una sola vez, en la 4)", pos(conMejor) === "1:a2,2:a3,3:a4,4:a1,5:a5,6:a6" && new Set(conMejor.posiciones.map((p) => p.id)).size === conMejor.posiciones.length, pos(conMejor));
  check("los stats del automatico no cambian por fijar (misma poblacion)", JSON.stringify(conMejor.stats) === JSON.stringify(sinFijos.stats));

  // La categoria del fijado cuenta como usada en etapas 1 y 2; la 3 puede repetir.
  const repetida = combinarConFijados(
    [cand("x1", "gX", colores(6)), cand("y1", "gY", colores(1))],
    [fij("F", 1, colores(2), { grupo: "gX" })],
    { ...base, cantidad: 3 }
  );
  check("categoria del fijado = usada: y1 (otra categoria) antes, x1 solo como 'relleno-categoria'", pos(repetida) === "1:F,2:y1,3:x1" && repetida.posiciones[1].etapa === "rango" && repetida.posiciones[2].etapa === "relleno-categoria", `${pos(repetida)} ${repetida.posiciones.map((p) => p.etapa).join()}`);
  const fueraRango2 = combinarConFijados(
    [cand("o1", "gX", colores(3, BAJO)), cand("o2", "gY", colores(1, BAJO))],
    [fij("F", 1, colores(2), { grupo: "gX" })],
    { ...base, cantidad: 3 }
  );
  check("idem en 'relleno-precio': la categoria del fijado no se repite ahi, o1 queda para la etapa 3", pos(fueraRango2) === "1:F,2:o2,3:o1" && fueraRango2.posiciones[1].etapa === "relleno-precio" && fueraRango2.posiciones[2].etapa === "relleno-categoria", `${pos(fueraRango2)} ${fueraRango2.posiciones.map((p) => p.etapa).join()}`);
  const sinGrupo = combinarConFijados([cand("z1", "gZ", colores(2))], [fij("F", 1, colores(2), { grupo: null })], { ...base, cantidad: 2 });
  check("un fijado sin categoria no marca ninguna como usada", sinGrupo.posiciones[1]?.etapa === "rango", sinGrupo.posiciones.map((p) => p.etapa).join());

  // Se muestra aunque no cumpla el criterio automatico, con avisos.
  const avisos = combinarConFijados([], [
    fij("caro", 1, colores(2, ALTO)),
    fij("sinstock", 2, [v("Rojo", 3, 3)]),
    fij("oculta", 3, colores(2), { categoriaVisible: false }),
    fij("todo", 4, [v("Rojo", 0, 0, ALTO)], { categoriaVisible: false }),
    fij("ok", 5, colores(2)),
  ], base);
  const aviso = (id: string) => (avisos.posiciones.find((p) => p.id === id)?.advertencias ?? []).join("+");
  check("fijado fuera de rango: se muestra con 'fuera-de-rango'", aviso("caro") === "fuera-de-rango", aviso("caro"));
  check("fijado sin stock: se muestra con 'sin-stock' (y tambien fuera de rango no, su precio esta en rango)", aviso("sinstock") === "sin-stock", aviso("sinstock"));
  check("fijado en categoria oculta: se muestra con 'categoria-oculta'", aviso("oculta") === "categoria-oculta", aviso("oculta"));
  check("avisos acumulables y en orden estable", aviso("todo") === "sin-stock+fuera-de-rango+categoria-oculta", aviso("todo"));
  check("fijado sano: sin avisos; las 5 posiciones se muestran", aviso("ok") === "" && avisos.posiciones.length === 5 && avisos.omitidos.length === 0);
  check("el precio del fijado es el de la card (Desde, 1 unidad, sin IVA)", Number(avisos.posiciones.find((p) => p.id === "caro")!.precio) === 29000 && avisos.posiciones.find((p) => p.id === "ok")!.colores === 2);

  // Pausado / eliminado / sin foto: se saltea, la posicion la llena el automatico.
  const saltados = combinarConFijados(autos, [
    fij("pausado", 1, colores(2), { activo: false }),
    fij("sinfoto", 3, colores(2), { conFoto: false }),
    fij("sinvar", 4, []),
    fij("vivo", 2),
  ], base);
  check("pausado/eliminado y sin foto no se muestran: sus posiciones las llena el automatico", pos(saltados) === "1:a1,2:vivo,3:a2,4:a3,5:a4,6:a5,7:a6", pos(saltados));
  check("se informan como omitidos con su motivo", saltados.omitidos.map((o) => `${o.rank}:${o.id}:${o.motivo}`).join() === "1:pausado:pausado-eliminado,3:sinfoto:sin-foto,4:sinvar:sin-variantes", saltados.omitidos.map((o) => `${o.rank}:${o.id}:${o.motivo}`).join());
  check("pausado + sin foto: manda 'pausado-eliminado'", combinarConFijados([], [fij("x", 1, colores(1), { activo: false, conFoto: false })], base).omitidos[0]?.motivo === "pausado-eliminado");
  check("un omitido no cuenta su categoria como usada", combinarConFijados([cand("c", "gQ", colores(2))], [fij("x", 1, colores(1), { activo: false, grupo: "gQ" })], { ...base, cantidad: 1 }).posiciones[0]?.etapa === "rango");

  // Rangos fuera de 1..cantidad.
  const fuera = combinarConFijados(autos, [fij("r0", 0), fij("r9", 9), fij("rneg", -1), fij("rfrac", 1.5), fij("r8", 8)], base);
  check("rangos 0, 9, -1 y 1.5 no se muestran; el 8 vale", pos(fuera) === "1:a1,2:a2,3:a3,4:a4,5:a5,6:a6,8:r8", pos(fuera));
  check("se INFORMAN como omitidos 'posicion-fuera-de-rango' (siguen ocupando el unique)", fuera.omitidos.length === 4 && fuera.omitidos.every((o) => o.motivo === "posicion-fuera-de-rango") && fuera.omitidos.map((o) => o.id).sort().join() === "r0,r9,rfrac,rneg", fuera.omitidos.map((o) => `${o.id}:${o.motivo}`).join());
  check("un fuera de rango no se vuelve a elegir de relleno ni cuenta su categoria", combinarConFijados([cand("c", "gQ", colores(2))], [fij("c", 9, colores(2), { grupo: "gQ" })], { ...base, cantidad: 3 }).posiciones.length === 0);
  const chico = combinarConFijados(autos, [fij("r3", 3), fij("r5", 5)], { ...base, cantidad: 4 });
  check("con cantidad 4 el rango 5 queda fuera (y se informa) y el 3 vale", pos(chico) === "1:a1,2:a2,3:r3,4:a3" && chico.omitidos.length === 1 && chico.omitidos[0].id === "r5" && chico.omitidos[0].motivo === "posicion-fuera-de-rango", pos(chico));

  // Todos fijados: el automatico no agrega nada.
  const todos = combinarConFijados(autos, Array.from({ length: 8 }, (_, i) => fij(`T${8 - i}`, i + 1)), base);
  check("con las 8 posiciones fijadas el automatico no agrega nada", todos.posiciones.length === 8 && todos.posiciones.every((p) => p.origen === "fijado") && pos(todos) === "1:T8,2:T7,3:T6,4:T5,5:T4,6:T3,7:T2,8:T1", pos(todos));

  // Pool corto: los huecos quedan al final de lo libre, nunca se inventa.
  const corto = combinarConFijados([cand("u1", "g1", colores(2)), cand("u2", "g2", colores(1))], [fij("F", 5)], base);
  check("pool corto: el automatico llena 1 y 2, la 3 y 4 quedan vacias, el fijado sigue en la 5", pos(corto) === "1:u1,2:u2,5:F", pos(corto));
  check("FEATURED_PRODUCTS_COUNT sigue en 8", FEATURED_PRODUCTS_COUNT === 8);

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
  console.log("\n=========== H. FIJADOS (base local, ESCRIBE y restaura) ===========");
  // =========================================================================
  // Las acciones del panel son envolturas finas (requireAdmin + invalidar) de
  // src/lib/destacados-admin.ts: la logica transaccional se prueba ahi, que
  // no depende de la sesion. Que las acciones exijan admin e invaliden se
  // verifica en la seccion G (estatico).
  const adm = await import("../src/lib/destacados-admin");
  const N = FEATURED_PRODUCTS_COUNT;
  const fechaH = "2026-10-06";
  const rankDe = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id }, select: { featuredRank: true } })).featuredRank;
  const titular = async (r: number) => (await prisma.product.findFirst({ where: { featuredRank: r }, select: { id: true } }))?.id ?? null;
  const fijadosAhora = async () => (await prisma.product.findMany({ where: { featuredRank: { not: null } }, select: { id: true, featuredRank: true }, orderBy: { featuredRank: "asc" } })).map((p) => `${p.featuredRank}:${p.id}`).join();

  // Estado previo, para dejar la base como estaba.
  const fijadosPrevios = await prisma.product.findMany({ where: { featuredRank: { not: null } }, select: { id: true, featuredRank: true } });
  await prisma.product.updateMany({ where: { featuredRank: { not: null } }, data: { featuredRank: null } });
  const universo = (await getFeaturedPreview(5000, fechaH)).posiciones;
  check("hay productos reales para probar fijados", universo.length >= 12, `${universo.length}`);
  const P = universo.slice(0, 12).map((p) => p.id);
  const toquetes = await prisma.product.findMany({ where: { id: { in: P } }, select: { id: true, active: true, deletedAt: true } });
  const imagenesMain = await prisma.productImage.findMany({ where: { productId: { in: P }, isMain: true }, select: { id: true, productId: true } });

  try {
    // fijar
    let r = await adm.fijarProducto(P[0], 3);
    check("fijar P0 en la 3", r.success && (await rankDe(P[0])) === 3, JSON.stringify(r));
    r = await adm.fijarProducto(P[1], 3);
    check("fijar P1 en la 3 (ocupada) desplaza a P0 al automatico", r.success && (await rankDe(P[1])) === 3 && (await rankDe(P[0])) === null, `${await fijadosAhora()}`);
    r = await adm.fijarProducto(P[1], 5);
    check("fijar un producto ya fijado en otra posicion lo MUEVE (la 3 queda libre)", r.success && (await rankDe(P[1])) === 5 && (await titular(3)) === null, `${await fijadosAhora()}`);
    r = await adm.fijarProducto(P[1], 5);
    check("fijar en la posicion que ya ocupa es idempotente", r.success && (await rankDe(P[1])) === 5);

    // entradas invalidas (nada cambia)
    const antes = await fijadosAhora();
    const invalidas: Array<[string, () => Promise<{ success: boolean; error?: string }>]> = [
      ["posicion 0", () => adm.fijarProducto(P[2], 0)],
      [`posicion ${N + 1}`, () => adm.fijarProducto(P[2], N + 1)],
      ["posicion 1.5", () => adm.fijarProducto(P[2], 1.5)],
      ["posicion NaN", () => adm.fijarProducto(P[2], NaN)],
      ["posicion como string", () => adm.fijarProducto(P[2], "3" as unknown as number)],
      ["producto inexistente", () => adm.fijarProducto("no-existe", 2)],
      ["id vacio", () => adm.fijarProducto("", 2)],
      ["soltar posicion 0", () => adm.soltarPosicion(0, P[2])],
      ["soltar posicion fraccionaria", () => adm.soltarPosicion(1.5, P[2])],
      ["mover una posicion sin fijado", () => adm.moverPosicion(7, "arriba", P[2])],
      ["mover con direccion invalida", () => adm.moverPosicion(5, "izquierda" as unknown as "arriba", P[1])],
    ];
    for (const [nombre, f] of invalidas) {
      const res = await f();
      check(`rechaza: ${nombre}`, !res.success && typeof res.error === "string" && res.error.length > 5, res.error ?? "acepto");
    }
    // pausado, eliminado, sin foto
    await prisma.product.update({ where: { id: P[2] }, data: { active: false } });
    let res = await adm.fijarProducto(P[2], 2);
    check("rechaza fijar un producto pausado", !res.success && /paus|activ/i.test(res.error ?? ""), res.error);
    await prisma.product.update({ where: { id: P[2] }, data: { active: true, deletedAt: new Date() } });
    res = await adm.fijarProducto(P[2], 2);
    check("rechaza fijar un producto eliminado", !res.success, res.error);
    await prisma.product.update({ where: { id: P[2] }, data: { deletedAt: null } });
    await prisma.productImage.updateMany({ where: { productId: P[2] }, data: { isMain: false } });
    res = await adm.fijarProducto(P[2], 2);
    check("rechaza fijar un producto sin foto principal", !res.success && /foto/i.test(res.error ?? ""), res.error);
    await prisma.productImage.updateMany({ where: { id: { in: imagenesMain.filter((i) => i.productId === P[2]).map((i) => i.id) } }, data: { isMain: true } });
    check("las entradas invalidas no cambiaron nada", (await fijadosAhora()) === antes, `${antes} vs ${await fijadosAhora()}`);

    // mover
    await adm.soltarPosicion(5, P[1]);
    await adm.fijarProducto(P[0], 2);
    await adm.fijarProducto(P[1], 3);
    let m = await adm.moverPosicion(2, "abajo", P[0]);
    check("mover hacia un vecino fijado intercambia a los dos", m.success && (await rankDe(P[0])) === 3 && (await rankDe(P[1])) === 2, await fijadosAhora());
    m = await adm.moverPosicion(3, "abajo", P[0]);
    check("mover hacia una posicion automatica solo mueve el rank (la 3 queda libre)", m.success && (await rankDe(P[0])) === 4 && (await titular(3)) === null && (await rankDe(P[1])) === 2, await fijadosAhora());
    m = await adm.moverPosicion(4, "arriba", P[0]);
    check("subir tambien", m.success && (await rankDe(P[0])) === 3);
    await adm.fijarProducto(P[3], 1);
    m = await adm.moverPosicion(1, "arriba", P[3]);
    check("subir desde la 1 se rechaza", !m.success && (await rankDe(P[3])) === 1, m.error);
    await adm.fijarProducto(P[4], N);
    m = await adm.moverPosicion(N, "abajo", P[4]);
    check(`bajar desde la ${N} se rechaza`, !m.success && (await rankDe(P[4])) === N, m.error);

    // soltar
    let so = await adm.soltarPosicion(3, P[0]);
    check("soltar vuelve al automatico", so.success && (await rankDe(P[0])) === null);
    so = await adm.soltarPosicion(3, P[0]);
    check("soltar una posicion que ya no tiene ese producto se rechaza (pestana vieja)", !so.success && /Otra persona/.test(so.error ?? ""), so.error);

    // pestana vieja: la posicion ahora es de OTRO producto
    await adm.fijarProducto(P[0], 2);
    await adm.fijarProducto(P[2], 2); // desplaza a P0
    so = await adm.soltarPosicion(2, P[0]);
    check("soltar con el producto viejo NO suelta al que acaba de fijar otro admin", !so.success && (await rankDe(P[2])) === 2, so.error);
    m = await adm.moverPosicion(2, "abajo", P[0]);
    check("mover con el producto viejo se rechaza y no cambia nada", !m.success && /Otra persona/.test(m.error ?? "") && (await rankDe(P[2])) === 2 && (await rankDe(P[0])) === null, m.error);
    await adm.fijarProducto(P[1], 3);
    m = await adm.moverPosicion(3, "arriba", P[2]);
    check("mover con un producto que no esta en esa posicion se rechaza (no mueve el de la 3)", !m.success && (await rankDe(P[1])) === 3 && (await rankDe(P[2])) === 2, m.error);
    so = await adm.soltarPosicion(2, P[2]);
    check("soltar con el producto correcto funciona", so.success && (await rankDe(P[2])) === null);
    await adm.soltarPosicion(3, P[1]);
        await adm.fijarProducto(P[3], 1); await adm.fijarProducto(P[1], 2); await adm.fijarProducto(P[4], N);

    // carreras: la unica restriccion es la base; nunca debe tirar
    await adm.soltarPosicion(1, P[3]); await adm.soltarPosicion(2, P[1]); await adm.soltarPosicion(N, P[4]);
    const rs = await Promise.all([adm.fijarProducto(P[5], 6), adm.fijarProducto(P[6], 6), adm.fijarProducto(P[7], 6), adm.fijarProducto(P[5], 7)]);
    const quedan = await prisma.product.count({ where: { featuredRank: 6 } });
    check("cuatro fijados en carrera: ninguno tira, a lo sumo uno ocupa la 6", rs.every((x) => typeof x.success === "boolean") && quedan <= 1, `${rs.map((x) => x.success ? "ok" : x.error).join(" | ")} -> ${await fijadosAhora()}`);
    await adm.fijarProducto(P[8], 2); await adm.fijarProducto(P[9], 3);
    const rm = await Promise.all([adm.moverPosicion(2, "abajo", P[8]), adm.moverPosicion(3, "arriba", P[9])]);
    check("dos intercambios cruzados en carrera: ninguno tira y no queda nada duplicado", rm.every((x) => typeof x.success === "boolean"), rm.map((x) => x.success ? "ok" : x.error).join(" | "));
    await prisma.product.updateMany({ where: { featuredRank: { not: null } }, data: { featuredRank: null } });

    // lector de la home == vista previa, con fijados de verdad
    await adm.fijarProducto(P[0], 2);
    await adm.fijarProducto(P[1], 5);
    await adm.fijarProducto(P[10], 7);
    await prisma.product.update({ where: { id: P[10] }, data: { active: false } }); // fijado pero pausado
    for (const fecha of [fechaH, "2026-10-07", "2026-10-08"]) {
      const pv = await getFeaturedPreview(N, fecha);
      const hm = await getFeaturedProducts(N, fecha);
      check(`[${fecha}] la home y la vista previa devuelven los mismos ids en el mismo orden`, hm.map((x) => x.id).join() === pv.posiciones.map((x) => x.id).join(), `${hm.length} vs ${pv.posiciones.length}`);
    }
    const pvH = await getFeaturedPreview(N, fechaH);
    check("el fijado esta en SU posicion (2 y 5) y los otros lo respetan", pvH.posiciones.find((x) => x.posicion === 2)?.id === P[0] && pvH.posiciones.find((x) => x.posicion === 5)?.id === P[1] && pvH.posiciones.filter((x) => x.origen === "fijado").length === 2, pvH.posiciones.map((x) => `${x.posicion}:${x.origen[0]}`).join());
    check("8 posiciones, sin repetir ids", pvH.posiciones.length === N && new Set(pvH.posiciones.map((x) => x.id)).size === N);
    check("el fijado pausado no sale y se informa con su nombre y motivo", !pvH.posiciones.some((x) => x.id === P[10]) && pvH.omitidos.length === 1 && pvH.omitidos[0].id === P[10] && pvH.omitidos[0].rank === 7 && pvH.omitidos[0].motivo === "pausado-eliminado" && pvH.omitidos[0].name.length > 0, JSON.stringify(pvH.omitidos));
    const homeH = await getFeaturedProducts(N, fechaH);
    check("la home mantiene la forma de siempre (images + variantes activas)", homeH.length === N && homeH.every((x) => x.images.length === 1 && x.variants.length > 0 && "discountPercent" in x.variants[0]));
    await prisma.product.update({ where: { id: P[10] }, data: { active: true } });
    check("reactivado, el fijado vuelve solo a su posicion", (await getFeaturedPreview(N, fechaH)).posiciones.find((x) => x.posicion === 7)?.id === P[10]);

    // el automatico llena exactamente lo que dejaria sin fijados
    await prisma.product.updateMany({ where: { featuredRank: { not: null } }, data: { featuredRank: null } });
    const libre = (await getFeaturedPreview(N, fechaH)).posiciones.map((x) => x.id);
    await adm.fijarProducto(libre[0], 4);
    const conUno = (await getFeaturedPreview(N, fechaH)).posiciones;
    check("fijar el que el automatico ya habia elegido lo deja en la posicion pedida", conUno[3]?.id === libre[0] && conUno[3].origen === "fijado" && new Set(conUno.map((x) => x.id)).size === N, conUno.map((x) => x.id).join());
    await prisma.product.updateMany({ where: { featuredRank: { not: null } }, data: { featuredRank: null } });

    // cache: la consulta de fijados esta en el mismo lector, y featured la suelta
    shim.entradas.clear();
    await lectura.getFeaturedProductsPublico(N);
    const antesCache = (await lectura.getFeaturedProductsPublico(N)).map((x) => x.id);
    await adm.fijarProducto(P[11], 1); // por la lib: no invalida (eso lo hace la accion)
    const sigueViejo = (await lectura.getFeaturedProductsPublico(N)).map((x) => x.id);
    check("sin invalidar, la tienda sigue con lo cacheado", sigueViejo.join() === antesCache.join() && sigueViejo[0] !== P[11]);
    invalidarCachePublico([TAG.featured]);
    check("invalidar 'featured' saca la entrada", entradasDestacados().length === 0);
    const nuevo = (await lectura.getFeaturedProductsPublico(N)).map((x) => x.id);
    check("la lectura siguiente trae el fijado en la posicion 1", nuevo[0] === P[11] && nuevo.length === N, nuevo.join());
    await adm.soltarPosicion(1, P[11]);
    invalidarCachePublico([TAG.featured]);

    // buscador
    const unico = await prisma.product.findUniqueOrThrow({ where: { id: P[0] }, select: { name: true, variants: { select: { sku: true }, take: 1 } } });
    // El nombre entero: una palabra suelta ("Mochila") trae mas de 20 productos y el tope los corta.
    const tipeo = unico.name.toUpperCase();
    let b = await adm.buscarProductosParaFijar(tipeo);
    check("buscar por nombre (mayusculas) encuentra el producto, con los datos de la fila", b.success && b.productos.some((x) => x.id === P[0]) && b.productos.length <= 20 && b.productos.every((x) => x.name && typeof x.precio === "number" && typeof x.tieneStock === "boolean" && "fijadoEn" in x && "categoryName" in x && "imageUrl" in x), b.success ? `${b.productos.length} resultados` : b.error);
    b = await adm.buscarProductosParaFijar("a");
    check("menos de 2 letras: se rechaza con mensaje", !b.success && /2/.test(b.error ?? ""), b.success ? "acepto" : b.error);
    b = await adm.buscarProductosParaFijar("   x ");
    check("los espacios no cuentan para el minimo", !b.success);
    const conTilde = await prisma.product.findFirst({ where: { active: true, deletedAt: null, images: { some: { isMain: true } }, name: { contains: "ó" } }, select: { id: true, name: true } });
    if (conTilde) {
      const sinTilde = conTilde.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-z]{4,}/)?.[0] ?? "";
      b = await adm.buscarProductosParaFijar(sinTilde);
      check("busca sin importar acentos ni mayusculas", b.success && b.productos.length > 0, `'${sinTilde}'`);
    } else {
      console.log("OMITIDO busqueda sin acentos: no hay producto con 'ó' en la base local");
    }
    if (unico.variants[0]) {
      b = await adm.buscarProductosParaFijar(unico.variants[0].sku.slice(0, 12));
      check("busca tambien por sku de variante", b.success && b.productos.some((x) => x.id === P[0]), unico.variants[0].sku);
    }
    b = await adm.buscarProductosParaFijar("  " + unico.name.slice(0, 30) + " ".repeat(300) + "zzz");
    check("el texto se recorta a 100 caracteres ANTES de buscar (el 'zzz' del final no cuenta)", b.success && b.productos.some((x) => x.id === P[0]), b.success ? `${b.productos.length}` : b.error);
    b = await adm.buscarProductosParaFijar("x".repeat(20000));
    check("un texto enorme no tira ni devuelve nada raro", b.success && b.productos.length === 0);
    b = await adm.buscarProductosParaFijar("100%_");
    check("los comodines de LIKE se tratan como texto (no devuelve todo)", b.success && b.productos.length < 5, b.success ? `${b.productos.length}` : b.error);
    await adm.fijarProducto(P[0], 6);
    b = await adm.buscarProductosParaFijar(tipeo);
    check("el buscador informa en que posicion esta fijado cada uno", b.success && b.productos.find((x) => x.id === P[0])?.fijadoEn === 6 && b.productos.filter((x) => x.fijadoEn !== null).every((x) => x.fijadoEn === 6));
    await prisma.product.update({ where: { id: P[0] }, data: { active: false } });
    b = await adm.buscarProductosParaFijar(tipeo);
    check("el buscador no ofrece pausados", b.success && !b.productos.some((x) => x.id === P[0]));
    await prisma.product.update({ where: { id: P[0] }, data: { active: true, deletedAt: new Date() } });
    b = await adm.buscarProductosParaFijar(tipeo);
    check("ni eliminados", b.success && !b.productos.some((x) => x.id === P[0]));
    await prisma.productImage.updateMany({ where: { productId: P[0] }, data: { isMain: false } });
    await prisma.product.update({ where: { id: P[0] }, data: { deletedAt: null } });
    b = await adm.buscarProductosParaFijar(tipeo);
    check("ni sin foto principal", b.success && !b.productos.some((x) => x.id === P[0]));
  } finally {
    // Restaurar: estados tocados, fotos principales y fijados previos.
    for (const t of toquetes) await prisma.product.update({ where: { id: t.id }, data: { active: t.active, deletedAt: t.deletedAt, featuredRank: null } });
    await prisma.productImage.updateMany({ where: { id: { in: imagenesMain.map((i) => i.id) } }, data: { isMain: true } });
    await prisma.product.updateMany({ where: { featuredRank: { not: null } }, data: { featuredRank: null } });
    for (const f of fijadosPrevios) await prisma.product.update({ where: { id: f.id }, data: { featuredRank: f.featuredRank } });
    invalidarCachePublico([TAG.store]);
  }
  check("la base quedo como estaba (mismos fijados que antes)", (await fijadosAhora()) === fijadosPrevios.map((f) => `${f.featuredRank}:${f.id}`).join() && (await prisma.productImage.count({ where: { id: { in: imagenesMain.map((i) => i.id) }, isMain: true } })) === imagenesMain.length);

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


  // Fijados: acciones, conectores, componentes.
  const accionesFn = [...acciones.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  check("[estatico] las acciones de fijados existen", ["fijarDestacado", "soltarDestacado", "moverDestacado", "buscarProductosParaFijar"].every((n) => accionesFn.includes(n)), accionesFn.join());
  check("[estatico] CADA accion exige requireAdmin()", (acciones.match(/await requireAdmin\(\)/g) ?? []).length === accionesFn.length, `${(acciones.match(/await requireAdmin\(\)/g) ?? []).length} requireAdmin para ${accionesFn.length} acciones`);
  check("[estatico] las 3 mutaciones pasan por alTerminar, que invalida SOLO featured y revalida /admin/destacados y /", /return alTerminar\(await fijarProducto/.test(acciones) && /return alTerminar\(await soltarPosicion/.test(acciones) && /return alTerminar\(await moverPosicion/.test(acciones) && /function alTerminar[\s\S]*?if \(r\.success\)[\s\S]*?invalidarCachePublico\(\[TAG\.featured\]\)[\s\S]*?revalidatePath\("\/admin\/destacados"\)[\s\S]*?revalidatePath\("\/"\)/.test(acciones) && !/invalidarCachePublico\(\[(?!TAG\.featured\])/.test(acciones));
  check("[estatico] soltar y mover reciben el productId esperado (no actuan sobre una posicion a ciegas)", /soltarDestacado\(\s*posicion: number,\s*productId: string/.test(acciones) && /moverDestacado\(\s*posicion: number,\s*direccion: "arriba" \| "abajo",\s*productId: string/.test(acciones));
  const compsFijados = ["featured-positions.tsx", "featured-product-picker.tsx"].map((f) => fs.readFileSync(path.join(raiz, "src/components/admin", f), "utf8"));
  check("[estatico] los componentes de fijados no importan lectura-publica, prisma ni cache-publico", compsFijados.every((c) => !/lectura-publica|cache-publico|lib\/prisma/.test(c)));
  const libAdmin = fs.readFileSync(path.join(raiz, "src/lib/destacados-admin.ts"), "utf8");
  check("[estatico] destacados-admin.ts no importa lectura-publica ni cache-publico", !/lectura-publica|cache-publico/.test(libAdmin));
  const archivosSync = fs.readdirSync(path.join(raiz, "src/lib/sync")).map((f) => path.join(raiz, "src/lib/sync", f)).filter((f) => f.endsWith(".ts"));
  const scriptsSync = fs.readdirSync(path.join(raiz, "scripts")).map((f) => path.join(raiz, "scripts", f)).filter((f) => /sync|zecat|cdo|import/i.test(path.basename(f)) && f.endsWith(".ts"));
  const tocan = [...archivosSync, ...scriptsSync].filter((f) => fs.readFileSync(f, "utf8").includes("featuredRank"));
  check("[estatico] ningun conector ni script de sync nombra featuredRank", tocan.length === 0, tocan.join());
  const cambios = fs.readFileSync(path.join(raiz, "src/lib/sync/cambios.ts"), "utf8");
  check("[estatico] featuredRank no entra en publicHash", !cambios.includes("featuredRank"));
  const catalogSrc = fs.readFileSync(path.join(raiz, "src/lib/catalog.ts"), "utf8");
  check("[estatico] el lector pide los fijados en la MISMA vuelta (Promise.all) que los candidatos", /Promise\.all\(\[[^\]]*candidatosDestacables\(\)[^\]]*fijadosDestacables\(\)/.test(catalogSrc));
  check("[estatico] getFeaturedProductsPublico conserva su firma (take)", /export async function getFeaturedProductsPublico\(take: number\)/.test(fs.readFileSync(path.join(raiz, "src/lib/lectura-publica.ts"), "utf8")));

  await prisma.$disconnect();

  console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Verificacion de la cache publica de la tienda (unstable_cache + tags).
//
// Corre SOLO contra la base de prueba *_c_test del Postgres local, con Zecat
// SIMULADO (scripts/_zecat-falso.ts) y dolarapi interceptado: ningun request
// sale de la maquina.
//
//   DATABASE_URL=postgresql://…@localhost:5432/ganchito_estudio_c_test \
//     npx tsx scripts/audit-verify-cache.ts
//
// BORRA el catalogo y las corridas de la base de prueba al arrancar.
//
// Cada chequeo se marca [runtime] o [estatico]. Lo que no se puede ejecutar
// sin sesion de admin (Server Actions con requireAdmin) se verifica
// estaticamente sobre el codigo fuente.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Prisma, ProductOrigin, UsdRateMode } from "@prisma/client";

// --- Guarda: SOLO la base de prueba, en localhost ---------------------------
const db = new URL(process.env.DATABASE_URL ?? "postgres://x");
if (db.hostname !== "localhost" || !db.pathname.endsWith("_c_test")) {
  console.error(`ABORTADO: este script solo corre contra la base *_c_test en localhost (vino ${db.hostname}${db.pathname}).`);
  process.exit(1);
}

process.env.ZECAT_API_TOKEN = "falso";
process.env.CRON_SECRET = "secreto-de-prueba";
delete process.env.RESEND_API_KEY;
delete process.env.ALERT_EMAIL;

// La cache real (unstable_cache) no existe fuera de Next: se usa el sustituto
// en memoria que guarda JSON igual que ella, y el registro de invalidaciones.
globalThis.__ganchitoCacheShim = { entradas: new Map(), fallos: 0, aciertos: 0 };
const registro: string[][] = [];
globalThis.__ganchitoCacheRecorder = registro;

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}
const tagsDesde = (desde: number) => new Set(registro.slice(desde).flat());

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { avanzarCorrida } = await import("../src/lib/sync/motor");
  const { invalidarCachePublico, tagProducto, tagsPorProductos, TAG } = await import("../src/lib/cache-tags");
  const { calcularPublicHash, clasificarCambio, invalidaCache } = await import("../src/lib/sync/cambios");
  const { serializar, rehidratar } = await import("../src/lib/cache-serializar");
  const lectura = await import("../src/lib/lectura-publica");
  const { getProducts, getFeaturedProducts, getMenuGroups, getCatalogFilterOptions } = await import("../src/lib/catalog");
  const { getProductById } = await import("../src/lib/product");
  const { getPricingConfig, computePriceRange, computeEscalones, computeSellPrice } = await import("../src/lib/pricing");
  const { getSiteConfig } = await import("../src/lib/site-config");
  const { formatPriceArs } = await import("../src/lib/format");
  const { getQuoteItemsSummary } = await import("../src/app/(store)/cotizar/actions");
  const { confirmarYPausar } = await import("../src/lib/sync-run");
  const { barrerInvalidacionesPendientes, limpiarMarcas, limpiarTodasLasMarcas } = await import("../src/lib/sync/invalidaciones");
  const { levantarZecatFalso } = await import("./_zecat-falso");
  type EstadoFalso = import("./_zecat-falso").EstadoFalso;

  const raiz = process.cwd();

  // =========================================================================
  console.log("\n=========== A. LA COTIZACION Y EL ADMIN NUNCA LEEN DE LA CACHE ===========");
  // =========================================================================
  const PROHIBIDOS = [
    path.join(raiz, "src/lib/lectura-publica.ts"),
    path.join(raiz, "src/lib/cache-publico.ts"),
  ];

  function resolver(desde: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(raiz, "src", spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(desde), spec);
    else return null; // paquete
    for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
  }
  function importesDe(archivo: string): string[] {
    const src = fs.readFileSync(archivo, "utf8");
    const specs = [...src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);
    return specs.map((s) => resolver(archivo, s)).filter((x): x is string => x !== null);
  }
  /// Recorre transitivamente; devuelve la cadena hasta el primer prohibido.
  function alcanza(inicios: string[]): { cadena: string[] | null; visitados: number } {
    const visto = new Set<string>();
    const padre = new Map<string, string>();
    const cola = [...inicios];
    for (const i of inicios) visto.add(i);
    while (cola.length) {
      const actual = cola.shift()!;
      if (PROHIBIDOS.includes(actual)) {
        const cadena = [actual];
        while (padre.has(cadena[0])) cadena.unshift(padre.get(cadena[0])!);
        return { cadena: cadena.map((c) => path.relative(raiz, c)), visitados: visto.size };
      }
      for (const imp of importesDe(actual)) {
        if (!visto.has(imp)) {
          visto.add(imp);
          padre.set(imp, actual);
          cola.push(imp);
        }
      }
    }
    return { cadena: null, visitados: visto.size };
  }
  function archivosBajo(dir: string): string[] {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? archivosBajo(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  }

  const cotizar = archivosBajo(path.join(raiz, "src/app/(store)/cotizar"));
  const rCot = alcanza(cotizar);
  check("[estatico] cotizar/** no llega (transitivamente) a lectura-publica ni cache-publico", rCot.cadena === null, rCot.cadena ? rCot.cadena.join(" -> ") : `${rCot.visitados} archivos recorridos`);
  const admin = archivosBajo(path.join(raiz, "src/app/admin"));
  const rAdm = alcanza(admin);
  check("[estatico] admin/** no llega a lectura-publica ni cache-publico", rAdm.cadena === null, rAdm.cadena ? rAdm.cadena.join(" -> ") : `${rAdm.visitados} archivos recorridos`);
  const enCron = alcanza([
    ...archivosBajo(path.join(raiz, "src/app/api")),
    ...archivosBajo(path.join(raiz, "src/lib/sync")),
    path.join(raiz, "src/lib/sync-run.ts"),
    path.join(raiz, "src/lib/usd-rate.ts"),
  ]);
  check("[estatico] crons, sync y usd-rate (solo invalidan) no llegan a los lectores cacheados", enCron.cadena === null, enCron.cadena?.join(" -> ") ?? "");
  const usaUnstable = archivosBajo(path.join(raiz, "src")).filter((f) => fs.readFileSync(f, "utf8").includes("unstable_cache(") && !f.endsWith("cache-publico.ts"));
  check("[estatico] unstable_cache se usa solo en cache-publico.ts", usaUnstable.length === 0, usaUnstable.join(", "));

  const tienda = archivosBajo(path.join(raiz, "src/app/(store)")).filter((f) => !f.includes("/cotizar/"));
  const componentes = ["header.tsx", "footer.tsx"].map((n) => path.join(raiz, "src/components/layout", n));
  const crudos = [...tienda, ...componentes].filter((f) =>
    /\b(getPricingConfig|getSiteConfig|getMenuGroups|getProducts|getProductById|getCatalogFilterOptions|getFeaturedProducts|getHomeCategoryShowcase)\(/.test(fs.readFileSync(f, "utf8"))
  );
  check("[estatico] las paginas y componentes de la tienda (salvo cotizar) usan solo los lectores publicos", crudos.length === 0, crudos.map((f) => path.relative(raiz, f)).join(", "));

  // --- Preparar la base de prueba -------------------------------------------
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
  await prisma.pricingConfig.upsert({
    where: { id: 1 },
    update: { defaultMarginPercent: 45, usdRate: new Prisma.Decimal("1535.50"), usdRateMode: UsdRateMode.MANUAL },
    create: { id: 1, defaultMarginPercent: 45, usdRate: new Prisma.Decimal("1535.50"), usdRateMode: UsdRateMode.MANUAL },
  });
  await prisma.siteConfig.deleteMany({});

  // --- Zecat simulado --------------------------------------------------------
  const ids = Array.from({ length: 100 }, (_, i) => `c-${String(i).padStart(3, "0")}`);
  const estado: EstadoFalso = {
    listado: [...ids],
    detalle: new Map(),
    demoraDetalleMs: 0,
    listadoCaido: false,
    pedidosDetalle: new Map(),
    variaciones: new Map(),
  };
  const zecat = await levantarZecatFalso(estado);
  process.env.ZECAT_API_URL = zecat.url;
  process.env.SYNC_TICK_BUDGET_MS = "120000";

  async function sincronizar(quien = "consola") {
    const cambios = new Set<string>();
    let ultimo;
    for (let i = 0; i < 200; i++) {
      const r = await avanzarCorrida(ProductOrigin.ZECAT, quien, { esCron: false });
      // Lo que hace el cron / el panel en CADA tick, sea cual sea su estado:
      // barrer las marcas que dejaron los conectores en la base.
      await barrerInvalidacionesPendientes();
      r.cambios.productIds.forEach((x) => cambios.add(x));
      ultimo = r;
      if (r.estado === "completa" || r.estado === "fallo") break;
    }
    return { cambios, ultimo: ultimo! };
  }
  const productId = async (zecatId: string) => (await prisma.product.findUniqueOrThrow({ where: { zecatId } })).id;

  // =========================================================================
  console.log("\n=========== C. CLASIFICACION DEL CAMBIO (casos unitarios, puros) ===========");
  // =========================================================================
  const base = {
    name: "Termo", description: "d", currency: "ARS", minOrderQuantity: 1,
    heightCm: new Prisma.Decimal("10.5"), widthCm: null, lengthCm: null, weightG: null,
    active: true, categoryId: "cat1",
    variantes: [
      { sku: "A", colorName: "Rojo", colorHex: null, sizeName: null, materialName: null, costPrice: 100, discountPercent: 10, discountTiers: [{ min: 2, max: null, pct: 10 }], active: true },
      { sku: "B", colorName: "Azul", colorHex: null, sizeName: null, materialName: null, costPrice: 120, discountPercent: null, discountTiers: null, active: true },
    ],
    imagenes: [
      { url: "u1", isMain: true, sortOrder: 0, variantSku: null },
      { url: "u2", isMain: false, sortOrder: 1, variantSku: "A" },
      { url: "u3", isMain: false, sortOrder: 2, variantSku: "B" },
    ],
    areasImpresion: [{ externalId: "1", name: "Frente", heightCm: 5, widthCm: 5 }],
    tiposImpresion: [{ name: "Laser" }, { name: "Serigrafia" }],
    atributos: [],
  };
  const h0 = calcularPublicHash(base);
  const stock = (a: number, b: number) => [
    { sku: "A", stock: a, reservedStock: 0 },
    { sku: "B", stock: b, reservedStock: 0 },
  ];
  const antes = (hash: string | null, a = 100, b = 100) => ({ publicHash: hash, variantes: stock(a, b) });
  const cls = (hash: string, ant: ReturnType<typeof antes> | null, nuevo: ReturnType<typeof stock>) => clasificarCambio(ant, hash, nuevo);

  check("sin cambios -> sin-cambio", cls(h0, antes(h0), stock(100, 100)) === "sin-cambio");
  check("hash anterior null -> publico", cls(h0, antes(null), stock(100, 100)) === "publico");
  check("producto nuevo (sin estado anterior) -> publico", cls(h0, null, stock(100, 100)) === "publico");
  check("cambia el nombre -> publico", cls(calcularPublicHash({ ...base, name: "Termo 2" }), antes(h0), stock(100, 100)) === "publico");
  check("cambia el costo de una variante -> publico", cls(calcularPublicHash({ ...base, variantes: [{ ...base.variantes[0], costPrice: 101 }, base.variantes[1]] }), antes(h0), stock(100, 100)) === "publico");
  check("cambia active -> publico", cls(calcularPublicHash({ ...base, active: false }), antes(h0), stock(100, 100)) === "publico");
  check("variante nueva -> publico", cls(calcularPublicHash({ ...base, variantes: [...base.variantes, { ...base.variantes[1], sku: "C" }] }), antes(h0), stock(100, 100)) === "publico");
  check("variante quitada -> publico", cls(calcularPublicHash({ ...base, variantes: [base.variantes[0]] }), antes(h0), [stock(100, 100)[0]]) === "publico");
  check("cambia la categoria -> publico", cls(calcularPublicHash({ ...base, categoryId: "cat2" }), antes(h0), stock(100, 100)) === "publico");
  check("cambia una imagen (url) -> publico", cls(calcularPublicHash({ ...base, imagenes: [{ ...base.imagenes[0], url: "otra" }, ...base.imagenes.slice(1)] }), antes(h0), stock(100, 100)) === "publico");
  check("cambia un tipo de impresion -> publico", cls(calcularPublicHash({ ...base, tiposImpresion: [{ name: "Laser" }] }), antes(h0), stock(100, 100)) === "publico");
  check("mismas imagenes en otro orden de arreglo -> sin-cambio", cls(calcularPublicHash({ ...base, imagenes: [...base.imagenes].reverse(), tiposImpresion: [...base.tiposImpresion].reverse(), variantes: [...base.variantes].reverse() }), antes(h0), stock(100, 100)) === "sin-cambio");
  check("costo como number, string o Decimal da el mismo hash", calcularPublicHash({ ...base, variantes: [{ ...base.variantes[0], costPrice: "100.00" }, { ...base.variantes[1], costPrice: new Prisma.Decimal("120") }] }) === h0);
  check("orden de claves de discountTiers no cambia el hash", calcularPublicHash({ ...base, variantes: [{ ...base.variantes[0], discountTiers: [{ pct: 10, max: null, min: 2 }] }, base.variantes[1]] }) === h0);
  check("stock 100 -> 0 (cruza el cero hacia abajo) -> stock-cero", cls(h0, antes(h0), stock(0, 100)) === "stock-cero");
  check("stock 0 -> 5 (cruza el cero hacia arriba) -> stock-cero", cls(h0, antes(h0, 0, 100), stock(5, 100)) === "stock-cero");
  check("stock +50 % sin cruzar el cero -> stock-menor (ya NO invalida)", cls(h0, antes(h0), stock(150, 100)) === "stock-menor");
  check("stock -50 % sin cruzar el cero -> stock-menor (ya NO invalida)", cls(h0, antes(h0), stock(50, 100)) === "stock-menor");
  check("stock +21 % -> stock-menor (la regla del 20 % se elimino)", cls(h0, antes(h0), stock(121, 100)) === "stock-menor");
  check("stock -21 % -> stock-menor", cls(h0, antes(h0), stock(79, 100)) === "stock-menor");
  check("stock 100 -> 1 (casi agotado, sin cruzar) -> stock-menor", cls(h0, antes(h0), stock(1, 100)) === "stock-menor");
  check("solo invalidan publico y stock-cero", invalidaCache("publico") && invalidaCache("stock-cero") && !invalidaCache("stock-menor") && !invalidaCache("sin-cambio"));
  check("solo cambia reservedStock con el disponible igual -> stock-menor", cls(h0, antes(h0), [{ sku: "A", stock: 101, reservedStock: 1 }, stock(0, 100)[1]]) === "stock-menor");
  check("disponible se calcula neto (stock - reservado, piso 0)", cls(h0, { publicHash: h0, variantes: [{ sku: "A", stock: 10, reservedStock: 10 }, { sku: "B", stock: 5, reservedStock: 9 }] }, [{ sku: "A", stock: 10, reservedStock: 10 }, { sku: "B", stock: 5, reservedStock: 0 }]) === "stock-cero");

  // =========================================================================
  console.log("\n=========== C. INTEGRACION: dos sincronizaciones seguidas (Zecat falso) ===========");
  // =========================================================================
  let m = registro.length;
  const s1 = await sincronizar();
  check("[runtime] 1a corrida completa", s1.ultimo.estado === "completa", s1.ultimo.estado);
  check("[runtime] 1a corrida: los 100 productos nuevos son 'publico'", s1.cambios.size === 100, `${s1.cambios.size}`);
  const t1 = tagsDesde(m);
  check("[runtime] la 1a corrida invalida catalog, menu y la ficha de cada producto", t1.has(TAG.catalog) && t1.has(TAG.menu) && [...s1.cambios].every((id) => t1.has(tagProducto(id))));
  const sinHash = await prisma.product.count({ where: { publicHash: null } });
  check("[runtime] publicHash queda persistido en todos", sinHash === 0, `${sinHash} sin hash`);

  m = registro.length;
  const s2 = await sincronizar();
  check("[runtime] 2a corrida (nada cambio): 0 de 100 invalidan", s2.cambios.size === 0, `${s2.cambios.size} invalidados`);
  check("[runtime] 2a corrida: no se invalida NINGUN tag", registro.length === m);

  // Cambios de la 3a corrida
  estado.variaciones!.set("c-001", { stock: "0" }); //   10 -> 0: cruza el cero            -> stock-cero
  estado.variaciones!.set("c-002", { stock: "11" }); //  +10 %                              -> menor
  estado.variaciones!.set("c-003", { name: "Nombre nuevo" }); //                           -> publico
  estado.variaciones!.set("c-004", { stock: "15" }); //  +50 %                              -> menor
  estado.variaciones!.set("c-005", { stock: "8" }); //   -20 %                              -> menor
  estado.variaciones!.set("c-006", { stock: "5" }); //   -50 %                              -> menor
  estado.detalle.set("c-007", "vacio"); //                sin variantes: queda inactivo    -> publico
  estado.listado = ids.filter((x) => x !== "c-099"); //   sale del listado...
  estado.detalle.set("c-099", "404"); //                  ...y el detalle confirma la baja -> pausa del cierre
  m = registro.length;
  const s3 = await sincronizar();
  check("[runtime] 3a corrida completa", s3.ultimo.estado === "completa", s3.ultimo.estado);
  const esperados = new Set(await Promise.all(["c-001", "c-003", "c-007", "c-099"].map(productId)));
  const iguales = s3.cambios.size === esperados.size && [...esperados].every((x) => s3.cambios.has(x));
  check("[runtime] 3a corrida: invalidan exactamente publico + stock-cero + ausente pausado (4)", iguales, `${s3.cambios.size} ids`);
  const menores = await Promise.all(["c-002", "c-004", "c-005", "c-006"].map(productId));
  check("[runtime] stock-menor (+10 %, +50 %, -20 %, -50 % sin cruzar el cero) NO invalida", menores.every((id) => !s3.cambios.has(id)));
  const ausente = await prisma.product.findUniqueOrThrow({ where: { zecatId: "c-099" } });
  check("[runtime] el ausente confirmado quedo pausado Y su id llego a la invalidacion (finishSyncRun)", ausente.active === false && s3.cambios.has(ausente.id));
  const t3 = tagsDesde(m);
  check("[runtime] 3a corrida invalida catalog + menu + product:{id} de los 4 (y de ningun stock-menor)", t3.has(TAG.catalog) && t3.has(TAG.menu) && [...esperados].every((id) => t3.has(tagProducto(id))) && menores.every((id) => !t3.has(tagProducto(id))));

  // hash null guardado -> publico
  const c010 = await productId("c-010");
  await prisma.product.update({ where: { id: c010 }, data: { publicHash: null } });
  estado.variaciones!.set("c-001", { stock: "10" }); // 0 -> 10: cruza el cero hacia arriba -> stock-cero
  const s4 = await sincronizar();
  const c001 = await productId("c-001");
  check("[runtime] hash guardado null -> publico; y 0 -> 10 cruza el cero hacia arriba -> stock-cero (solo esos dos)", s4.cambios.size === 2 && s4.cambios.has(c010) && s4.cambios.has(c001), `${s4.cambios.size}`);

  // Pausa de conectores.ts (Zecat sin costo calculable): se cubre por codigo
  // y por el flujo existente (audit-verify-*); aca se comprueba que el
  // resultado del conector lleve productId + 'publico'.
  const fuenteConectores = fs.readFileSync(path.join(raiz, "src/lib/sync/conectores.ts"), "utf8");
  check("[estatico] el conector de Zecat que pausa por costo devuelve el id y cambio 'publico'", /resultado: "pausado",[\s\S]{0,120}productId: afectados\[0\]\?\.id,[\s\S]{0,40}cambio: "publico"/.test(fuenteConectores));
  const fuenteCdo = fs.readFileSync(path.join(raiz, "src/lib/cdo/sync.ts"), "utf8");
  check("[estatico] el apagado por foto de CDO entra en el hash (active) y se clasifica", fuenteCdo.includes("active: activo,") && fuenteCdo.includes("publicHash,") && fuenteCdo.includes("clasificarCambio("));

  // confirmarYPausar (lo que usa pausarAusentesDeCorrida y el cierre)
  const run = await prisma.syncRun.findFirstOrThrow({ orderBy: { startedAt: "desc" } });
  estado.detalle.set("c-050", "404");
  const cp = await confirmarYPausar(ProductOrigin.ZECAT, ["c-050"], run.id);
  const p50 = await productId("c-050");
  check("[runtime] confirmarYPausar devuelve el Product.id de lo que pauso", cp.bajas.length === 1 && cp.pausadosIds.length === 1 && cp.pausadosIds[0] === p50);
  m = registro.length;
  invalidarCachePublico(tagsPorProductos(cp.pausadosIds));
  const tcp = tagsDesde(m);
  check("[runtime] pausar ausentes -> product:{id} + catalog + menu", tcp.has(tagProducto(p50)) && tcp.has(TAG.catalog) && tcp.has(TAG.menu));
  const cp2 = await confirmarYPausar(ProductOrigin.ZECAT, ["c-050"], run.id);
  check("[runtime] pausar de nuevo uno ya pausado no devuelve ids (no invalida de mas)", cp2.pausadosIds.length === 0);

  // =========================================================================
  console.log("\n=========== B. CADA CAMINO DE ESCRITURA INVALIDA SU TAG ===========");
  // =========================================================================
  // --- usd-rate (runtime, por la ruta del cron) ---
  const { GET: cronUsd } = await import("../src/app/api/cron/usd-rate/route");
  const fetchReal = globalThis.fetch;
  let ventaFalsa = 1600;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://dolarapi.com")) return Response.json({ venta: ventaFalsa });
    return fetchReal(input, init);
  }) as typeof fetch;
  const llamarCronUsd = () => cronUsd(new Request("http://x/api/cron/usd-rate", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));

  await prisma.pricingConfig.update({ where: { id: 1 }, data: { usdRateMode: UsdRateMode.MANUAL } });
  m = registro.length;
  let resp = await (await llamarCronUsd()).json();
  check("[runtime] usd-rate en MANUAL: solo-registrado y NO invalida", resp.status === "solo-registrado" && registro.length === m, resp.status);
  await prisma.pricingConfig.update({ where: { id: 1 }, data: { usdRateMode: UsdRateMode.AUTO } });
  m = registro.length;
  resp = await (await llamarCronUsd()).json();
  check("[runtime] usd-rate AUTO aplicado -> invalida 'pricing'", resp.status === "aplicado" && tagsDesde(m).has(TAG.pricing), resp.status);
  ventaFalsa = 99999; // la guarda de +-20 % la rechaza
  m = registro.length;
  resp = await (await llamarCronUsd()).json();
  check("[runtime] usd-rate rechazado por la guarda -> NO invalida", resp.status === "rechazado" && registro.length === m, resp.status);
  await prisma.pricingConfig.update({ where: { id: 1 }, data: { usdRateMode: UsdRateMode.MANUAL, usdRate: new Prisma.Decimal("1535.50") } });
  globalThis.fetch = fetchReal;

  // --- Server Actions y rutas con auth: verificacion estatica ---
  const leer = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");
  function cuerpo(src: string, nombre: string): string {
    const i = src.search(new RegExp(`export async function ${nombre}\\b`));
    if (i < 0) return "";
    const resto = src.slice(i + 10);
    const j = resto.search(/\n(?:export |async function |function )/);
    return j < 0 ? src.slice(i) : src.slice(i, i + 10 + j);
  }
  function estatico(nombre: string, texto: string, ...patrones: Array<string | RegExp>) {
    const falta = patrones.filter((p) => (typeof p === "string" ? !texto.includes(p) : !p.test(texto)));
    check(`[estatico] ${nombre}`, texto.length > 0 && falta.length === 0, falta.length ? `falta: ${falta.join(" | ")}` : "");
  }
  const cfg = leer("src/app/admin/(panel)/configuracion/actions.ts");
  const upd = cuerpo(cfg, "updatePricingConfig");
  estatico("updatePricingConfig -> pricing (despues del refresh AUTO)", upd, "invalidarCachePublico([TAG.pricing])");
  check("[estatico] updatePricingConfig invalida DESPUES de refreshUsdRate()", upd.indexOf("invalidarCachePublico") > upd.indexOf("await refreshUsdRate()") && upd.indexOf("await refreshUsdRate()") > 0);
  estatico("updateSiteConfig -> site", cuerpo(cfg, "updateSiteConfig"), "invalidarCachePublico([TAG.site])");
  const rn = cuerpo(cfg, "refreshUsdRateNow");
  estatico("refreshUsdRateNow -> pricing solo si 'aplicado'", rn, /if \(resultado\.status === "aplicado"\) \{\s*invalidarCachePublico\(\[TAG\.pricing\]\)/);
  const rt = cuerpo(cfg, "refrescarTienda");
  estatico("refrescarTienda -> store, y exige super admin ANTES de invalidar", rt, "invalidarCachePublico([TAG.store])", "requireSuperAdmin()");
  check("[estatico] refrescarTienda: requireSuperAdmin va antes de invalidar", rt.indexOf("requireSuperAdmin()") < rt.indexOf("invalidarCachePublico"));

  const prod = leer("src/app/admin/(panel)/productos/actions.ts");
  for (const fn of ["saveProduct", "toggleProductActive", "deleteProduct"]) {
    estatico(`${fn} -> product:{id}, catalog, menu`, cuerpo(prod, fn), /invalidarCachePublico\(\[tagProducto\((product|productId)(\.id)?\), TAG\.catalog, TAG\.menu\]\)/);
  }

  const cat = leer("src/app/admin/(panel)/categorias/actions.ts");
  const helper = cat.slice(cat.indexOf("function revalidarCatalogo"), cat.indexOf("async function marcarRevisada"));
  estatico("revalidarCatalogo -> categories, menu, catalog", helper, "invalidarCachePublico([TAG.categories, TAG.menu, TAG.catalog])");
  const accionesCat = [...cat.matchAll(/export async function (\w+)/g)].map((x) => x[1]);
  for (const fn of accionesCat) estatico(`categorias/${fn} llama a revalidarCatalogo()`, cuerpo(cat, fn), "revalidarCatalogo()");

  const prov = leer("src/app/admin/(panel)/proveedores/actions.ts");
  const st = cuerpo(prov, "syncTick");
  estatico("syncTick (panel) barre las invalidaciones pendientes en un finally alrededor del tick", st, /try \{\s*tick = await avanzarCorrida\([^)]*\);\s*\} finally \{\s*await barrerSinFallar\(/);
  check("[estatico] syncTick barre ANTES de mirar tick.estado (vale para avanzo/completa/fallo/ocupado/sin-corrida)", st.indexOf("barrerSinFallar(") > 0 && st.indexOf("barrerSinFallar(") < st.indexOf("tick.estado"));
  const pa = cuerpo(prov, "pausarAusentes");
  const psc = cuerpo(prov, "pausarSinConfirmacion");
  estatico("pausarAusentes -> product:{id} de lo pausado + catalog + menu, en finally", pa, /finally \{\s*invalidarCachePublico\(tagsPorProductos\(pausadosIds\)\)/, "pausadosDeError(error)");
  estatico("pausarSinConfirmacion -> product:{id} de lo pausado + catalog + menu, en finally", psc, /finally \{\s*invalidarCachePublico\(tagsPorProductos\(productIds\)\)/);
  estatico("updatePricingConfig: la invalidacion de 'pricing' esta en un finally que envuelve a refreshUsdRate()", upd, /try \{\s*if \(modo === UsdRateMode\.AUTO\) \{\s*await refreshUsdRate\(\);\s*\}\s*\} finally \{[\s\S]*?invalidarCachePublico\(\[TAG\.pricing\]\)/);
  estatico("saveProduct guarda publicHash: null (el proximo sync lo trata como 'publico')", cuerpo(prod, "saveProduct"), "publicHash: null");
  estatico("el motor recoge los ids pausados aunque finishSyncRun tire", leer("src/lib/sync/motor.ts"), /finishSyncRun\(lease\.runId\)[\s\S]{0,200}pausadosDeError\(error\)/);

  const cronSync = leer("src/app/api/cron/sync/[provider]/route.ts");
  estatico("cron del sync barra las invalidaciones pendientes en un finally alrededor del tick", cronSync, /try \{\s*resultadoTick = await avanzarCorrida\([^)]*\);\s*\} finally \{\s*await barrerSinFallar\(/);
  check("[estatico] el cron del sync barre ANTES de mirar tick.estado", cronSync.indexOf("barrerSinFallar(") > 0 && cronSync.indexOf("barrerSinFallar(") < cronSync.indexOf("tick.estado"));
  estatico("cron de usd-rate -> pricing dentro del bloque 'aplicado'", leer("src/app/api/cron/usd-rate/route.ts"), /if \(resultado\.status === "aplicado"\) \{\s*try \{[\s\S]*?invalidarCachePublico\(\[TAG\.pricing\]\)/);
  const sr = leer("src/lib/sync-run.ts");
  estatico("pausarSinConfirmacion (lib) devuelve los Product.id", cuerpo(sr, "pausarSinConfirmacion"), "productIds: filasAPausar.map");
  estatico("pausarAusentesDeCorrida (lib) devuelve pausadosIds", cuerpo(sr, "pausarAusentesDeCorrida"), "pausadosIds }");
  estatico("finishSyncRun devuelve los ids que auto-pauso", cuerpo(sr, "finishSyncRun"), "pausadosIds: confirmacion.pausadosIds");
  estatico("el motor acumula los ids del cierre y los devuelve en 'cambios'", leer("src/lib/sync/motor.ts"), "for (const id of fin.pausadosIds) acumulado.add(id)", "cambios: { productIds: [...acumulado] }");
  estatico("conector Zecat: la marca va en el upsert del producto (misma transaccion)", leer("src/lib/zecat/sync.ts"), "invalidacionPendienteDesde: new Date()", "update: { ...productData, ...marca }", "create: { zecatId: String(detail.id), ...productData, ...marca }");
  estatico("conector CDO: la marca va en el upsert del producto (misma transaccion)", leer("src/lib/cdo/sync.ts"), "invalidacionPendienteDesde: new Date()", "update: { ...productData, ...marca }", "create: { cdoId: String(product.id), ...productData, ...marca }");
  estatico("«Refrescar tienda» toma la hora ANTES de invalidar `store` y limpia solo hasta esa hora", rt, "limpiarTodasLasMarcas(hasta)");
  check("[estatico] refrescarTienda: `const hasta = new Date()` va antes de invalidar", rt.indexOf("const hasta = new Date()") > 0 && rt.indexOf("const hasta = new Date()") < rt.indexOf("invalidarCachePublico([TAG.store])"));
  const srcSync = leer("src/lib/sync-run.ts");
  const srcCon = leer("src/lib/sync/conectores.ts");
  estatico("pausar() (ausentes) pone publicHash: null en la misma escritura", srcSync, /data: \{ active: false, publicHash: null, invalidacionPendienteDesde: new Date\(\) \},\s*\}\);\s*return ids;/);
  estatico("pausarSinConfirmacion pone publicHash: null en la misma escritura", cuerpo(srcSync, "pausarSinConfirmacion"), "data: { active: false, publicHash: null, invalidacionPendienteDesde: new Date() }");
  estatico("pausa por costo no calculable (Zecat) pone publicHash: null en la misma escritura", srcCon, "data: { active: false, publicHash: null, invalidacionPendienteDesde: new Date() }");
  estatico("toggleProductActive y deleteProduct (manuales) ponen publicHash: null", prod, "data: { active, publicHash: null }", "data: { deletedAt: new Date(), active: false, publicHash: null }");
  const escriben = archivosBajo(path.join(raiz, "src")).filter((f) => /data:\s*\{[^}]*\bactive:\s*(false|active)\b/.test(fs.readFileSync(f, "utf8")) && !/\.tsx$/.test(f));
  check("[estatico] ningun otro archivo escribe `active:` de un producto fuera de los revisados", escriben.every((f) => /sync-run\.ts|conectores\.ts|productos\/actions\.ts|(zecat|cdo)\/sync\.ts/.test(f)), escriben.map((f) => path.relative(raiz, f)).join(", "));

  // --- Durabilidad: una invocacion muere entre el commit y la invalidacion ---
  console.log("\n--- Invalidacion DURABLE (marcas en la base) ---");
  const marcados = () => prisma.product.findMany({ where: { invalidacionPendienteDesde: { not: null } }, select: { id: true, invalidacionPendienteDesde: true } });
  await barrerInvalidacionesPendientes(); // arrancar sin marcas
  check("[runtime] sin cambios no hay marcas (los sin-cambio no marcan)", (await marcados()).length === 0);

  // Un tick que COMMITEA y "muere" antes de invalidar: se llama al motor y NO se barre.
  estado.variaciones!.set("c-020", { name: "Cambio que no se llego a invalidar" }); // publico
  estado.variaciones!.set("c-021", { stock: "0" }); //                                  stock-cero
  estado.variaciones!.set("c-022", { stock: "20" }); //                                 +100 % sin cruzar: stock-menor
  let tickMuerto;
  m = registro.length;
  for (let i = 0; i < 200; i++) {
    tickMuerto = await avanzarCorrida(ProductOrigin.ZECAT, "consola", { esCron: false });
    if (tickMuerto.estado === "completa" || tickMuerto.estado === "fallo") break;
  }
  const id20 = await productId("c-020");
  const id21 = await productId("c-021");
  const id22 = await productId("c-022");
  const tras = await marcados();
  check("[runtime] el tick commiteo y 'murio' sin invalidar: ningun tag se invalido", registro.length === m);
  check("[runtime] ...pero dejo marca en la base para publico y stock-cero, y NINGUNA para el stock-menor", tras.some((x) => x.id === id20) && tras.some((x) => x.id === id21) && !tras.some((x) => x.id === id22) && tras.every((x) => [id20, id21].includes(x.id)), `${tras.length} marcas`);
  const filasMarcadas = await prisma.product.findMany({ where: { id: { in: [id20, id21] } }, select: { publicHash: true, name: true, invalidacionPendienteDesde: true } });
  check("[runtime] la marca y el cambio quedaron escritos juntos (nombre nuevo + marca)", filasMarcadas.every((x) => x.invalidacionPendienteDesde !== null) && filasMarcadas.some((x) => x.name === "Cambio que no se llego a invalidar"));

  // La SIGUIENTE invocacion del cron (por la ruta real). El ultimo tick completo
  // tiene menos de 6 h, asi que el motor responde "sin-corrida": el barrido corre igual.
  const { GET: cronSyncGet } = await import("../src/app/api/cron/sync/[provider]/route");
  await prisma.supplier.upsert({ where: { origin: ProductOrigin.ZECAT }, update: { autoSyncEnabled: true }, create: { origin: ProductOrigin.ZECAT, name: "Zecat", autoSyncEnabled: true } });
  m = registro.length;
  const respCron = await cronSyncGet(new Request("http://x/api/cron/sync/zecat", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), { params: Promise.resolve({ provider: "zecat" }) });
  const jsonCron = (await respCron.json()) as { tick?: { estado: string } };
  const tcron = tagsDesde(m);
  check("[runtime] el cron siguiente (tick 'sin-corrida', nada que hacer) igual barre", jsonCron.tick?.estado === "sin-corrida", jsonCron.tick?.estado);
  check("[runtime] ...e invalida las fichas de lo que quedo sin invalidar (+ catalog + menu)", tcron.has(tagProducto(id20)) && tcron.has(tagProducto(id21)) && tcron.has(TAG.catalog) && tcron.has(TAG.menu));
  check("[runtime] ...y NO toca el stock-menor", !tcron.has(tagProducto(id22)));
  check("[runtime] ...y limpia las marcas de lo que acaba de invalidar", (await marcados()).length === 0);
  check("[runtime] la respuesta del cron no filtra la lista de ids (solo el tick)", !("cambios" in (jsonCron.tick ?? {})));
  m = registro.length;
  await barrerInvalidacionesPendientes();
  check("[runtime] barrer sin marcas no invalida nada (idempotente)", registro.length === m);

  // Limpieza selectiva: solo lo que se invalido Y sigue siendo la marca leida.
  const [pA, pB, pC] = await Promise.all(["c-030", "c-031", "c-032"].map(productId));
  const marca1 = new Date("2026-10-20T10:00:00.000Z");
  await prisma.product.updateMany({ where: { id: { in: [pA, pB] } }, data: { invalidacionPendienteDesde: marca1 } });
  const snapshot = await marcados(); // lo que el barrido LEYO e invalido: A y B
  const t2 = new Date("2026-10-20T10:00:05.000Z");
  await prisma.product.update({ where: { id: pB }, data: { invalidacionPendienteDesde: t2 } }); // un tick renovo B despues de leer
  await prisma.product.update({ where: { id: pC }, data: { invalidacionPendienteDesde: t2 } }); // y marco C que el barrido nunca vio
  await limpiarMarcas(snapshot);
  const resto = new Map((await marcados()).map((x) => [x.id, x.invalidacionPendienteDesde!.getTime()]));
  check("[runtime] se limpia lo invalidado cuya marca no cambio (A)", !resto.has(pA));
  check("[runtime] NO se limpia la marca renovada despues de leer (B queda con la fecha nueva)", resto.get(pB) === t2.getTime());
  check("[runtime] NO se limpia lo que el barrido no invalido (C)", resto.get(pC) === t2.getTime());
  // Tope de tags por barrido: por encima, un solo pedido `store`.
  await prisma.product.updateMany({ where: { zecatId: { startsWith: "c-04" } }, data: { invalidacionPendienteDesde: new Date() } });
  m = registro.length;
  const grande = await barrerInvalidacionesPendientes(5);
  check("[runtime] con mas marcas que el tope se invalida `store` (un pedido) y se limpia todo", grande.ids.length >= 10 && registro.length === m + 1 && registro[m].length === 1 && registro[m][0] === TAG.store && (await marcados()).length === 0, `${grande.ids.length} ids`);
  // Refrescar tienda
  await prisma.product.updateMany({ where: { zecatId: { startsWith: "c-05" } }, data: { invalidacionPendienteDesde: new Date() } });
  const hastaRefresco = new Date(); // lo que hace «Refrescar tienda» ANTES de invalidar
  const [pRa, pRb] = await Promise.all(["c-053", "c-054"].map(productId));
  await prisma.product.update({ where: { id: pRa }, data: { invalidacionPendienteDesde: new Date(hastaRefresco.getTime() - 1000) } });
  await prisma.product.update({ where: { id: pRb }, data: { invalidacionPendienteDesde: new Date(hastaRefresco.getTime() + 60_000) } }); // un tick escribio DESPUES del pedido
  const limpiadas = await limpiarTodasLasMarcas(hastaRefresco);
  const quedan = new Set((await marcados()).map((x) => x.id));
  check("[runtime] «Refrescar tienda» borra las marcas anteriores a su pedido (incluidas las del lote c-05x)", limpiadas >= 1 && !quedan.has(pRa));
  check("[runtime] ...pero una marca con fecha POSTERIOR al pedido sobrevive", quedan.has(pRb) && quedan.size === 1);
  await limpiarTodasLasMarcas(new Date(Date.now() + 3_600_000));
  // pausar() marca
  estado.detalle.set("c-060", "404");
  const cpm = await confirmarYPausar(ProductOrigin.ZECAT, ["c-060"], run.id);
  const p60 = await productId("c-060");
  check("[runtime] pausar un ausente deja marca en la misma transaccion", cpm.pausadosIds[0] === p60 && (await marcados()).some((x) => x.id === p60));
  await barrerInvalidacionesPendientes();

  // Pausa -> el proveedor lo devuelve IGUAL -> tiene que invalidar
  const fila60 = await prisma.product.findUniqueOrThrow({ where: { id: p60 } });
  check("[runtime] pausar() deja publicHash en null junto con active=false", fila60.active === false && fila60.publicHash === null);
  const p61 = await productId("c-061");
  await prisma.product.update({ where: { id: p61 }, data: { active: false, invalidacionPendienteDesde: new Date() } }); // CONTROL: la pausa vieja, sin anular el hash
  await barrerInvalidacionesPendientes();
  estado.detalle.delete("c-060");
  m = registro.length;
  const reactiva = await sincronizar();
  check("[runtime] (control del bug) pausado SIN anular el hash y devuelto igual: sin-cambio, no invalida", !reactiva.cambios.has(p61) && !tagsDesde(m).has(tagProducto(p61)));
  check("[runtime] pausado por pausar() y devuelto igual por el proveedor: clasifica publico, queda marcado e invalida", reactiva.cambios.has(p60) && tagsDesde(m).has(tagProducto(p60)));
  const despues60 = await prisma.product.findUniqueOrThrow({ where: { id: p60 } });
  check("[runtime] ...y el producto volvio a active=true con su hash recalculado", despues60.active === true && despues60.publicHash !== null);

  // Interruptor apagado: el cron igual barre (y no sincroniza)
  const p33 = await productId("c-033");
  await prisma.product.update({ where: { id: p33 }, data: { invalidacionPendienteDesde: new Date() } });
  await prisma.supplier.update({ where: { origin: ProductOrigin.ZECAT }, data: { autoSyncEnabled: false } });
  m = registro.length;
  const corridasAntes = await prisma.syncRun.count();
  const respOff = await cronSyncGet(new Request("http://x/api/cron/sync/zecat", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), { params: Promise.resolve({ provider: "zecat" }) });
  const jsonOff = (await respOff.json()) as { skipped?: string };
  check("[runtime] interruptor apagado: el cron responde skipped=disabled", jsonOff.skipped === "disabled");
  check("[runtime] ...pero igual barre: invalida la ficha marcada y limpia la marca", tagsDesde(m).has(tagProducto(p33)) && !(await marcados()).some((x) => x.id === p33));
  check("[runtime] ...y no arranca ninguna corrida", (await prisma.syncRun.count()) === corridasAntes);
  await prisma.supplier.update({ where: { origin: ProductOrigin.ZECAT }, data: { autoSyncEnabled: true } });

  // --- El helper: dedupe y fuera de Next ---
  m = registro.length;
  invalidarCachePublico([TAG.pricing, TAG.pricing, TAG.site, TAG.pricing]);
  check("[runtime] el helper deduplica tags dentro de una llamada", registro.length === m + 1 && registro[m].length === 2, JSON.stringify(registro[m]));
  let tiro = false;
  try {
    invalidarCachePublico([TAG.menu]);
  } catch {
    tiro = true;
  }
  check("[runtime] fuera de Next el helper NO tira (consola)", !tiro);

  // --- El helper sigue tras un tag que falla, y lo loguea (revalidateTag simulado) ---
  const nextCache = createRequire(path.join(raiz, "x.js"))("next/cache") as { revalidateTag: (tag: string, o: unknown) => void };
  const revalidateOriginal = nextCache.revalidateTag;
  const intentadosReal: string[] = [];
  const intentadosBenigno: string[] = [];
  const logsErrorReal: string[] = [];
  const logsErrorBenigno: string[] = [];
  const logsWarn: string[] = [];
  const consoleError = console.error;
  const consoleWarn = console.warn;
  console.warn = (...a: unknown[]) => void logsWarn.push(a.join(" "));
  try {
    // Fallo real (no es "fuera de Next"): loguea CADA vez, con el tag.
    console.error = (...a: unknown[]) => void logsErrorReal.push(a.join(" "));
    nextCache.revalidateTag = (tag: string) => {
      intentadosReal.push(tag);
      if (tag === "boom") throw new Error("429 simulado");
    };
    invalidarCachePublico(["boom", TAG.menu, TAG.site]);
    invalidarCachePublico(["boom"]);
    // Caso benigno (fuera de Next): sin console.error, y sigue con los demas.
    console.error = (...a: unknown[]) => void logsErrorBenigno.push(a.join(" "));
    nextCache.revalidateTag = (tag: string) => {
      intentadosBenigno.push(tag);
      throw new Error("Invariant: static generation store missing in revalidateTag");
    };
    invalidarCachePublico([TAG.menu, TAG.site, TAG.catalog]);
  } finally {
    nextCache.revalidateTag = revalidateOriginal;
    console.error = consoleError;
    console.warn = consoleWarn;
  }
  check("[runtime] un tag que falla NO frena a los siguientes (boom, menu, site, y luego boom otra vez)", intentadosReal.join() === `boom,${TAG.menu},${TAG.site},boom`, intentadosReal.join());
  check("[runtime] el fallo real se loguea con console.error CADA vez, con el tag y el mensaje", logsErrorReal.length === 2 && logsErrorReal.every((l) => l.includes('"boom"') && l.includes("429 simulado")), `${logsErrorReal.length} logs`);
  check("[runtime] el caso 'fuera de Next' no usa console.error y tambien intenta todos los tags", logsErrorBenigno.length === 0 && intentadosBenigno.length === 3, `${intentadosBenigno.length} intentados`);
  check("[runtime] el aviso 'fuera de Next' se da a lo sumo UNA vez", logsWarn.length <= 1, `${logsWarn.length} warns`);
  // =========================================================================
  console.log("\n=========== D. IDA Y VUELTA DE DECIMAL Y DATE (precios identicos) ===========");
  // =========================================================================
  // Producto en USD con decimales "feos", escala de descuentos, dimensiones y fecha.
  const cat1 = await prisma.category.create({ data: { name: "Cat prueba cache", slug: `cat-prueba-cache-${Date.now()}`, visible: true } });
  const usd = await prisma.product.create({
    data: {
      origin: ProductOrigin.CDO, cdoId: "9300001", name: "Producto USD cache", description: "d", currency: "USD", active: true,
      categoryId: cat1.id, heightCm: new Prisma.Decimal("12.35"), lastSyncedAt: new Date("2026-10-19T12:34:56.789Z"),
      images: { create: [{ url: "https://x.test/a.jpg", isMain: true, sortOrder: 0 }] },
      variants: {
        create: [
          { sku: "cdo-9300001-A", colorName: "Rojo", stock: 10, reservedStock: 0, costPrice: new Prisma.Decimal("194.97"), active: true,
            discountPercent: new Prisma.Decimal("12.50"), discountTiers: [{ min: 2, max: 9, pct: 5 }, { min: 10, max: null, pct: 12.5 }] },
          { sku: "cdo-9300001-B", colorName: "Azul", stock: 3, reservedStock: 1, costPrice: new Prisma.Decimal("205.23"), active: true },
        ],
      },
    },
  });
  await prisma.pricingConfig.update({ where: { id: 1 }, data: { usdRate: new Prisma.Decimal("1535.37"), defaultMarginPercent: new Prisma.Decimal("45.5") } });

  const configDb = await getPricingConfig();
  const configCache = await lectura.getPricingConfigPublica();
  check("[runtime] PricingConfig cacheada: Decimal (instancia) y Date (instancia)", Prisma.Decimal.isDecimal(configCache.usdRate) && configCache.updatedAt instanceof Date);
  check("[runtime] PricingConfig cacheada: mismos valores que la base", ["defaultMarginPercent", "usdRate", "vatRate"].every((k) => String((configCache as unknown as Record<string, unknown>)[k]) === String((configDb as unknown as Record<string, unknown>)[k])) && configCache.updatedAt.getTime() === configDb.updatedAt.getTime());
  const muestra = { d: new Prisma.Decimal("0.1"), f: new Date("2026-01-02T03:04:05.006Z"), n: null, l: [new Prisma.Decimal("1e-7"), { x: 7 }], t: "texto", u: undefined };
  const vuelta = rehidratar<typeof muestra>(JSON.parse(JSON.stringify(serializar(muestra))));
  check("[runtime] serializar/rehidratar: Decimal, Date, null, anidados y numeros viajan sin perdida", Prisma.Decimal.isDecimal(vuelta.d) && vuelta.d.equals("0.1") && vuelta.f instanceof Date && vuelta.f.getTime() === muestra.f.getTime() && vuelta.n === null && Prisma.Decimal.isDecimal(vuelta.l[0]) && vuelta.l[0].equals(muestra.l[0] as Prisma.Decimal) && (vuelta.l[1] as { x: number }).x === 7 && vuelta.t === "texto" && !("u" in vuelta));
  const crudoJson = JSON.parse(JSON.stringify(configDb)) as { usdRate: unknown };
  check("[runtime] (el problema real) sin rehidratar, un Decimal vuelve como string", typeof crudoJson.usdRate === "string");

  // Ficha
  const idsMuestra = [usd.id, ...(await prisma.product.findMany({ where: { active: true, origin: ProductOrigin.ZECAT }, take: 25, select: { id: true } })).map((p) => p.id)];
  let fichasIguales = 0;
  let escalonesIguales = 0;
  for (const id of idsMuestra) {
    const a = await getProductById(id);
    const b = await lectura.getProductByIdPublico(id);
    if (!a || !b) continue;
    const rangoA = computePriceRange(a.variants, a.currency, configDb);
    const rangoB = computePriceRange(b.variants, b.currency, configCache);
    if (JSON.stringify(rangoA) === JSON.stringify(rangoB)) fichasIguales++;
    const escA = a.variants.map((v) => computeEscalones(v, a.currency, configDb, formatPriceArs));
    const escB = b.variants.map((v) => computeEscalones(v, b.currency, configCache, formatPriceArs));
    if (JSON.stringify(escA) === JSON.stringify(escB)) escalonesIguales++;
  }
  check(`[runtime] ficha: rango de precios identico, cache vs base (${idsMuestra.length} productos)`, fichasIguales === idsMuestra.length, `${fichasIguales}`);
  check(`[runtime] ficha: escalones por cantidad identicos, cache vs base`, escalonesIguales === idsMuestra.length, `${escalonesIguales}`);
  const fichaUsd = (await lectura.getProductByIdPublico(usd.id))!;
  const fichaUsdDb = (await getProductById(usd.id))!;
  const ventaDb = fichaUsdDb.variants.map((v) => computeSellPrice(v.costPrice, fichaUsdDb.currency, configDb).toString());
  const ventaCache = fichaUsd.variants.map((v) => computeSellPrice(v.costPrice, fichaUsd.currency, configCache).toString());
  check("[runtime] producto USD: precio de venta exacto (digito a digito) igual", JSON.stringify(ventaDb) === JSON.stringify(ventaCache), JSON.stringify(ventaCache));
  check("[runtime] variantes de la ficha: costPrice y discountPercent son Decimal, discountTiers conserva su JSON", fichaUsd.variants.every((v) => Prisma.Decimal.isDecimal(v.costPrice)) && Prisma.Decimal.isDecimal(fichaUsd.variants[0].discountPercent) && JSON.stringify(fichaUsd.variants[0].discountTiers) === JSON.stringify(fichaUsdDb.variants[0].discountTiers));
  check("[runtime] ficha: dimensiones Decimal y fechas Date intactas", Prisma.Decimal.isDecimal(fichaUsd.heightCm) && fichaUsd.heightCm!.toString() === fichaUsdDb.heightCm!.toString() && fichaUsd.lastSyncedAt instanceof Date && fichaUsd.lastSyncedAt.toISOString() === "2026-10-19T12:34:56.789Z" && fichaUsd.createdAt instanceof Date);
  check("[runtime] ficha inexistente: null tanto cacheada como no", (await lectura.getProductByIdPublico("no-existe")) === null && (await getProductById("no-existe")) === null);

  // --- Ficha: id invalido y not-found NO tocan / NO ensucian la cache ---
  const sh = globalThis.__ganchitoCacheShim!;
  let lecturasFicha = 0;
  const productoDb = prisma.product as unknown as { findUnique: (...a: unknown[]) => unknown };
  const findUniqueOriginal = productoDb.findUnique;
  productoDb.findUnique = function (...a: unknown[]) {
    lecturasFicha++;
    return findUniqueOriginal.apply(this, a);
  };
  try {
    const e0 = { n: sh.entradas.size, f: sh.fallos, a: sh.aciertos };
    for (const basura of ["no-existe", "", "../../etc/passwd", "x".repeat(500), "C" + "a".repeat(24), "<script>"]) {
      if ((await lectura.getProductByIdPublico(basura)) !== null) check(`[runtime] id invalido ${JSON.stringify(basura.slice(0, 20))} devuelve null`, false);
    }
    check("[runtime] ids con forma invalida: null, 0 lecturas a la base y NADA en la cache", lecturasFicha === 0 && sh.entradas.size === e0.n && sh.fallos === e0.f && sh.aciertos === e0.a, `${lecturasFicha} lecturas`);

    const idValidoInexistente = `c${"0".repeat(24)}`;
    const nulo1 = await lectura.getProductByIdPublico(idValidoInexistente);
    const nulo2 = await lectura.getProductByIdPublico(idValidoInexistente);
    check("[runtime] id valido que no existe: null, y se lee de la base las DOS veces (el not-found no se cachea)", nulo1 === null && nulo2 === null && lecturasFicha === 2, `${lecturasFicha} lecturas`);
    check("[runtime] ...y no deja ninguna entrada 'product-by-id' para ese id", ![...sh.entradas.keys()].some((k) => k.includes(idValidoInexistente)));
    // Un producto que SI existe sigue cacheandose.
    // (se purga antes: la ficha ya estaba cacheada por los chequeos de arriba)
    invalidarCachePublico([tagProducto(usd.id)]);
    lecturasFicha = 0;
    await lectura.getProductByIdPublico(usd.id);
    await lectura.getProductByIdPublico(usd.id);
    check("[runtime] una ficha existente se cachea (2 lecturas -> 1 a la base)", lecturasFicha === 1, `${lecturasFicha}`);
  } finally {
    productoDb.findUnique = findUniqueOriginal;
  }

  // Grilla
  const gDb = await getProducts({ page: 1 });
  const gCache = await lectura.getProductsPublico({ page: 1 });
  const rangosDb = gDb.products.map((p) => computePriceRange(p.variants, p.currency, configDb));
  const rangosCache = gCache.products.map((p) => computePriceRange(p.variants, p.currency, configCache));
  check(`[runtime] grilla: mismos productos, total y paginas`, gDb.total === gCache.total && gDb.totalPages === gCache.totalPages && gDb.products.map((p) => p.id).join() === gCache.products.map((p) => p.id).join());
  check(`[runtime] grilla: "Desde $X"/precio exacto identico en los ${gDb.products.length} productos`, JSON.stringify(rangosDb) === JSON.stringify(rangosCache));
  const fPrecio = { page: 1, priceMin: 500, priceMax: 5000 };
  check("[runtime] grilla con filtro de precio: mismos ids", (await getProducts(fPrecio)).products.map((p) => p.id).join() === (await lectura.getProductsPublico(fPrecio)).products.map((p) => p.id).join());

  // Destacados / home / menu / filtros / site
  const dDb = await getFeaturedProducts(50);
  const dCache = await lectura.getFeaturedProductsPublico(50);
  check("[runtime] destacados: mismos productos y mismos rangos de precio", dDb.map((p) => p.id).join() === dCache.map((p) => p.id).join() && JSON.stringify(dDb.map((p) => computePriceRange(p.variants, p.currency, configDb))) === JSON.stringify(dCache.map((p) => computePriceRange(p.variants, p.currency, configCache))) && dDb.length >= 1, `${dDb.length}`);
  check("[runtime] menu: igual al de la base", JSON.stringify(await getMenuGroups()) === JSON.stringify(await lectura.getMenuGroupsPublico()));
  const oDb = await getCatalogFilterOptions();
  const oCache = await lectura.getCatalogFilterOptionsPublico();
  check("[runtime] opciones de filtro (con piso/techo de precio): iguales", JSON.stringify(oDb) === JSON.stringify(oCache) && oDb.precioTecho > 0, `piso ${oDb.precioPiso} techo ${oDb.precioTecho}`);
  await prisma.siteConfig.create({ data: { id: 1, contactEmail: "a@b.test", whatsappNumber: "5493511234567" } });
  const siteDb = await getSiteConfig();
  const siteCache = await lectura.getSiteConfigPublica();
  check("[runtime] contacto: igual (incluye updatedAt como Date)", siteCache.contactEmail === siteDb.contactEmail && siteCache.updatedAt instanceof Date && siteCache.updatedAt.getTime() === siteDb.updatedAt.getTime());
  const home = await lectura.getHomeCategoryShowcasePublico();
  check("[runtime] home (tiles): igual", JSON.stringify(home) === JSON.stringify(await (await import("../src/lib/home")).getHomeCategoryShowcase()));

  // Busqueda: sin cache
  const sh0 = () => ({ n: globalThis.__ganchitoCacheShim!.entradas.size, f: globalThis.__ganchitoCacheShim!.fallos });
  const antesFallos = globalThis.__ganchitoCacheShim!.fallos;
  const entradasAntes = globalThis.__ganchitoCacheShim!.entradas.size;
  await lectura.getProductsPublico({ page: 1, search: "Producto" });
  check("[runtime] la busqueda por texto NO se cachea", globalThis.__ganchitoCacheShim!.entradas.size === entradasAntes && globalThis.__ganchitoCacheShim!.fallos === antesFallos);
  // Filtro de precio: sin cache (claves arbitrarias sin tope)
  const eP = sh0();
  await lectura.getProductsPublico({ page: 1, priceMin: 123, priceMax: 4567 });
  await lectura.getProductsPublico({ page: 1, priceMin: 124 });
  await lectura.getProductsPublico({ page: 1, priceMax: 99999 });
  check("[runtime] la grilla con filtro de precio (min, max o ambos) NO se cachea", sh0().n === eP.n && sh0().f === eP.f, `${sh0().n - eP.n} entradas nuevas`);
  // Normalizacion de la clave
  const e0 = globalThis.__ganchitoCacheShim!.entradas.size;
  await lectura.getProductsPublico({ page: 1, colores: ["rojo", "azul"], categorySlug: "" });
  const e1 = globalThis.__ganchitoCacheShim!.entradas.size;
  await lectura.getProductsPublico({ page: 1, colores: ["azul", "rojo", "rojo"] });
  check("[runtime] la clave de la grilla se normaliza (colores en otro orden = misma entrada)", e1 === e0 + 1 && globalThis.__ganchitoCacheShim!.entradas.size === e1);

  // Tags de cada lector (lo que dice la tabla del diseno)
  const tagsDe = (clave: string) => [...globalThis.__ganchitoCacheShim!.entradas.entries()].filter(([k]) => k.startsWith(`${clave}:`)).map(([, e]) => new Set(e.tags));
  const tiene = (clave: string, esperados: string[], prohibidos: string[] = []) =>
    tagsDe(clave).length > 0 && tagsDe(clave).every((t) => esperados.every((x) => t.has(x)) && prohibidos.every((x) => !t.has(x)));
  check("[runtime] tags pricing-config = store, pricing", tiene("pricing-config", ["store", "pricing"]));
  check("[runtime] tags site-config = store, site", tiene("site-config", ["store", "site"]));
  check("[runtime] tags menu-groups = store, menu, categories", tiene("menu-groups", ["store", "menu", "categories"]));
  check("[runtime] tags catalog-filter-options = store, catalog, pricing", tiene("catalog-filter-options", ["store", "catalog", "pricing"]));
  check("[runtime] tags products = store, catalog, categories (sin pricing: el filtro de precio no se cachea)", tiene("products", ["store", "catalog", "categories"], ["pricing"]));
  check("[runtime] tags product-by-id = store, product:{id}, categories", [...globalThis.__ganchitoCacheShim!.entradas.entries()].filter(([k]) => k.startsWith("product-by-id:")).every(([k, e]) => { const id = JSON.parse(k.slice("product-by-id:".length))[0]; return e.tags.includes("store") && e.tags.includes(`product:${id}`) && e.tags.includes("categories"); }));
  check("[runtime] tags featured-products y home-category-showcase = store, catalog", tiene("featured-products", ["store", "catalog"]) && tiene("home-category-showcase", ["store", "catalog"]));

  // Invalidacion efectiva sobre la cache
  const total0 = globalThis.__ganchitoCacheShim!.entradas.size;
  const hasta = globalThis.__ganchitoCacheShim!.entradas;
  const conTag = (t: string) => [...hasta.values()].filter((e) => e.tags.includes(t)).length;
  const nUsd = conTag(`product:${usd.id}`);
  invalidarCachePublico([tagProducto(usd.id)]);
  check("[runtime] invalidar product:{id} saca SOLO esa ficha", nUsd === 1 && hasta.size === total0 - 1);
  const nPricing = conTag("pricing");
  invalidarCachePublico([TAG.pricing]);
  check("[runtime] invalidar 'pricing' saca la config y el piso/techo de precio", nPricing >= 2 && conTag("pricing") === 0, `${nPricing} entradas`);
  invalidarCachePublico([TAG.store]);
  check("[runtime] invalidar 'store' vacia TODA la cache publica", hasta.size === 0);
  const hitsAntes = globalThis.__ganchitoCacheShim!.aciertos;
  await lectura.getMenuGroupsPublico();
  await lectura.getMenuGroupsPublico();
  check("[runtime] la segunda lectura es un acierto de cache", globalThis.__ganchitoCacheShim!.aciertos === hitsAntes + 1);

  // --- El precio de venta NO esta en la cache ---
  const cacheado = JSON.stringify([...hasta.values()].map((e) => e.json));
  check("[runtime] ninguna entrada guarda precio de venta calculado (solo costos y config)", !/sellPrice|salePrice|unitPriceLabel|precioVenta/i.test(cacheado));

  // --- A (runtime): la cotizacion NO lee la cache ---
  console.log("\n--- A (runtime): cotizacion vs cache ---");
  await lectura.getPricingConfigPublica();
  await lectura.getSiteConfigPublica();
  const variante = fichaUsdDb.variants[0];
  const cotizo = () => getQuoteItemsSummary([{ productId: usd.id, variantSku: variante.sku, quantity: 1 }]);
  const antesQuote = await cotizo();
  await prisma.pricingConfig.update({ where: { id: 1 }, data: { defaultMarginPercent: new Prisma.Decimal("99") } });
  await prisma.siteConfig.update({ where: { id: 1 }, data: { whatsappNumber: null } });
  const despuesQuote = await cotizo();
  const configCacheVieja = await lectura.getPricingConfigPublica();
  const siteCacheVieja = await lectura.getSiteConfigPublica();
  check("[runtime] tras cambiar el margen en la base, la CACHE publica sigue vieja (45.5)", configCacheVieja.defaultMarginPercent.toString() === "45.5");
  check("[runtime] ...pero la cotizacion ya cotiza con el margen nuevo (lee la base)", antesQuote.items[0].unitPriceLabel !== despuesQuote.items[0].unitPriceLabel, `${antesQuote.items[0].unitPriceLabel} -> ${despuesQuote.items[0].unitPriceLabel}`);
  check("[runtime] la cotizacion usa el WhatsApp de la base (null), no el de la cache", antesQuote.whatsappAvailable === true && despuesQuote.whatsappAvailable === false && siteCacheVieja.whatsappNumber === "5493511234567");
  await prisma.pricingConfig.update({ where: { id: 1 }, data: { defaultMarginPercent: new Prisma.Decimal("45") } });

  // =========================================================================
  console.log("\n=========== E. FICHA: SIN TOPE DE STOCK Y AVISO DE PEDIDO MAYOR AL STOCK ===========");
  // =========================================================================
  const panelSrc = leer("src/components/product/purchase-panel.tsx");
  const AVISO = "Pedido mayor al stock informado; lo confirmamos al cotizar.";
  check("[estatico] purchase-panel contiene el texto exacto del aviso", panelSrc.includes(`"${AVISO}"`));
  check("[estatico] purchase-panel ya no recorta la cantidad al stock (sin maxQuantity ni Math.min contra disponible)", !/maxQuantity/.test(panelSrc) && !/Math\.min\([^)]*(available|disponible|tope)/.test(panelSrc) && !/const tope\b/.test(panelSrc));
  check("[estatico] el boton «+» ya no se deshabilita por stock", !/disabled=\{quantity >= /.test(panelSrc));
  check("[estatico] se conserva el piso de compra minima (lineFloor) en clampQuantity", /function clampQuantity\(value: number\): number \{\s*return Math\.max\(value, lineFloor\);/.test(panelSrc));
  check("[estatico] la atenuacion de la tabla ya no dice que no se puede pedir", panelSrc.includes('"Más unidades que el stock informado"') && !panelSrc.includes("disponibles hoy") && !/no se puede pedir hoy/.test(panelSrc));
  check("[estatico] «Consultar disponibilidad» y «Quedan N disponibles» siguen", panelSrc.includes("Consultar disponibilidad") && panelSrc.includes("Quedan {available} disponibles."));
  check("[estatico] el aviso va en una region aria-live", /<div aria-live="polite">\s*\{pedidoSuperaElStock/.test(panelSrc));

  // Render real (SSR) sin variantes: la cantidad inicial es el minimo de compra.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { PurchasePanel } = await import("../src/components/product/purchase-panel");
  const panel = (stock: number, minimo: number | null) =>
    renderToStaticMarkup(
      createElement(PurchasePanel, {
        productId: "p1",
        variants: [{ id: "v1", sku: "S1", colorName: null, sizeName: null, materialName: null, availableStock: stock, active: true }],
        minOrderQuantity: minimo,
        escalonesPorSku: { S1: [{ desde: 1, precio: "$ 100" }, { desde: 10, precio: "$ 90" }, { desde: 50, precio: "$ 80" }] },
        bulkFromQuantity: 2,
        fallbackPriceLabel: "$ 100",
      })
    );
  const conAviso = panel(3, 5); //  stock 3, minimo 5 -> la cantidad inicial (5) supera el stock
  check("[runtime] stock 3 y pedido 5: muestra el aviso (y no recorta: el input dice 5)", conAviso.includes(AVISO) && /value="5"/.test(conAviso));
  check("[runtime] el boton «+» no esta deshabilitado con el pedido por encima del stock", !/disabled=""[^>]*aria-label="Sumar"|aria-label="Sumar"[^>]*disabled=""/.test(conAviso));
  check("[runtime] stock 3 y pedido 5: filas de la tabla por encima del stock atenuadas con el titulo nuevo", conAviso.includes('title="Más unidades que el stock informado"'));
  const sinAviso = panel(10, 5);
  check("[runtime] stock 10 y pedido 5: sin aviso", !sinAviso.includes(AVISO));
  const agotado = panel(0, 5);
  check("[runtime] stock 0: «Consultar disponibilidad», sin aviso de stock y sin filas atenuadas", agotado.includes("Consultar disponibilidad") && !agotado.includes(AVISO) && !agotado.includes("stock informado\""));
  check("[runtime] stock 3 y pedido 3 (igual al stock): sin aviso", !panel(3, 3).includes(AVISO));

  // --- Limpieza ---
  await zecat.cerrar();
  await prisma.product.delete({ where: { id: usd.id } }).catch(() => {});
  await prisma.category.delete({ where: { id: cat1.id } }).catch(() => {});
  await prisma.$disconnect();
}

main()
  .then(() => {
    console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} CHEQUEO(S) FALLARON`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error("ERROR inesperado:", error);
    process.exit(1);
  });

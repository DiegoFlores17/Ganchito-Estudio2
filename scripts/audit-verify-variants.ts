// Verificacion de A2 (variantes que dejan de venir) contra la base LOCAL.
// Escribe productos de prueba (zecatId "a2test-*") y los borra al final.
//
//   npx tsx scripts/audit-verify-variants.ts
//
// No sale a la red: la API de Zecat esta interceptada (fetch) para el caso de
// la pagina anomala, y los mails van sin RESEND_API_KEY (solo se loguean).
import "dotenv/config";
import { ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { syncProduct, syncZecatBatch } from "../src/lib/zecat/sync";
import { acquireSyncRun, finishSyncRun, recordBatch } from "../src/lib/sync-run";
import { getProductById } from "../src/lib/product";
import { getCatalogFilterOptions, getFeaturedProducts, getProducts } from "../src/lib/catalog";
import { syncCdoProduct, vaciosQueSeApagarian, type CdoSyncSummary } from "../src/lib/cdo/sync";
import type { ImageProbe } from "../src/lib/cdo/normalize";
import type { CdoProduct } from "../src/lib/cdo/types";
import { getQuoteItemsSummary } from "../src/app/(store)/cotizar/actions";
import type { ZecatGenericProduct } from "../src/lib/zecat/types";

// Guarda de entorno: este script ESCRIBE. Solo contra localhost.
const destino = new URL(process.env.DATABASE_URL ?? "postgres://x").hostname;
if (destino !== "localhost" && destino !== "127.0.0.1") {
  console.error(`ABORTADO: DATABASE_URL apunta a ${destino}, no a localhost.`);
  process.exit(1);
}
delete process.env.RESEND_API_KEY;
process.env.ALERT_EMAIL = "alertas@ejemplo.test";

const PREFIJO = "a2test-";
// Color que SOLO tiene la variante C: si aparece en busqueda o filtros
// despues de desactivarla, la lectura no esta filtrando.
const COLOR_UNICO = "Zafiroprueba";
const CDO_IDS = [990000001, 990000002, 990000003];
let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

const logs: string[] = [];
const warnOriginal = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  logs.push(args.map(String).join(" "));
  // El mail entero sin API key es muy largo: se guarda, no se imprime.
  if (!String(args[0]).startsWith("[email] SIN RESEND_API_KEY")) warnOriginal(...args);
};

function detalle(id: string, skus: string[]): ZecatGenericProduct {
  return {
    id,
    name: `Producto de prueba ${id}`,
    description: "Prueba de A2",
    price: 1000,
    published: true,
    images: [{ image_url: `https://img.ejemplo.test/${id}.webp`, main: true }],
    variants: {
      colors: Object.fromEntries(
        skus.map((sku, i) => [
          String(i),
          [{ sku, elementDescription1: sku === "A2T-3" ? COLOR_UNICO : `Color ${i}`, attribute_one: { description: "Color" }, stock: "100", reservedStock: "0", active: true, discount_partner: 30 }],
        ])
      ),
      sizes: {},
    },
  } as unknown as ZecatGenericProduct;
}

async function variantes(zecatId: string) {
  const p = await prisma.product.findUniqueOrThrow({
    where: { zecatId },
    include: { variants: { orderBy: { sku: "asc" } } },
  });
  return { producto: p, porSku: new Map(p.variants.map((v) => [v.sku, v])) };
}

async function limpiar() {
  const productos = await prisma.product.findMany({
    where: {
      OR: [
        { zecatId: { startsWith: PREFIJO } },
        { cdoId: { in: CDO_IDS.map(String) } },
      ],
    },
    select: { id: true },
  });
  const ids = productos.map((p) => p.id);
  await prisma.quoteItem.deleteMany({ where: { productId: { in: ids } } });
  await prisma.quote.deleteMany({ where: { customerEmail: "a2test@ejemplo.test" } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await limpiar();
  const id = `${PREFIJO}1`;
  const [A, B, C] = ["A2T-1", "A2T-2", "A2T-3"];

  console.log("=========== SYNC: variante que deja de venir ===========");
  const r1 = await syncProduct(detalle(id, [A, B, C]));
  let { producto, porSku } = await variantes(id);
  check("3 variantes activas al crear", r1.outcome === "created" && [A, B, C].every((s) => porSku.get(s)?.active) && producto.active);

  // Una cotizacion "emitida" con la variante C, precio congelado.
  const quote = await prisma.quote.create({
    data: {
      shortCode: "A2TEST",
      customerName: "Prueba A2",
      customerEmail: "a2test@ejemplo.test",
      items: { create: [{ productId: producto.id, variantSku: C, quantity: 10, unitPrice: 1234.56 }] },
    },
    include: { items: true },
  });

  const buscarAntes = await getProducts({ page: 1, search: COLOR_UNICO });
  check("busqueda por el color de C: encuentra el producto (antes)", buscarAntes.products.some((p) => p.id === producto.id));
  const opcionesAntes = await getCatalogFilterOptions();
  const valorColor = opcionesAntes.colores.find((c) => c.etiqueta === COLOR_UNICO)?.valor;
  check("filtro de color: la opcion existe (antes)", Boolean(valorColor));
  const filtrarAntes = valorColor ? await getProducts({ page: 1, colores: [valorColor] }) : { products: [] };
  check("filtro de color: trae el producto (antes)", filtrarAntes.products.some((p) => p.id === producto.id));

  const r2 = await syncProduct(detalle(id, [A, B]));
  ({ producto, porSku } = await variantes(id));
  check("C deja de venir: queda INACTIVA, no se borra", porSku.get(C)?.active === false && porSku.has(C));
  check("A y B siguen activas, producto activo", porSku.get(A)!.active && porSku.get(B)!.active && producto.active);
  check("syncProduct informa 1 desactivada", r2.variantesDesactivadas === 1 && !r2.sinVariantes, JSON.stringify(r2));

  console.log("\n=========== LECTURAS ===========");
  const ficha = await getProductById(producto.id);
  check("ficha: solo las 2 activas", ficha?.variants.map((v) => v.sku).join(",") === `${A},${B}`, ficha?.variants.map((v) => v.sku).join(","));
  const destacados = await getFeaturedProducts(5000);
  const enDestacados = destacados.find((p) => p.id === producto.id);
  check("destacados: aparece, con solo las 2 activas", enDestacados?.variants.length === 2, String(enDestacados?.variants.length));
  const enGrilla = (await getProducts({ page: 1, search: "Producto de prueba a2test-1" })).products.find((p) => p.id === producto.id);
  check("grilla del catalogo: solo las 2 activas", enGrilla?.variants.length === 2, String(enGrilla?.variants.length));
  const buscarDespues = await getProducts({ page: 1, search: COLOR_UNICO });
  check("busqueda por el color de C: ya NO lo encuentra", !buscarDespues.products.some((p) => p.id === producto.id));
  const opcionesDespues = await getCatalogFilterOptions();
  check("filtro de color: la opcion desaparece", !opcionesDespues.colores.some((c) => c.etiqueta === COLOR_UNICO));
  const filtrarDespues = valorColor ? await getProducts({ page: 1, colores: [valorColor] }) : { products: [] };
  check("filtro de color: ya NO trae el producto", !filtrarDespues.products.some((p) => p.id === producto.id));
  const resumenC = await getQuoteItemsSummary([{ productId: producto.id, variantSku: C, quantity: 10 }]);
  check("cotizar con C: la linea se omite y va al aviso", resumenC.items.length === 0 && resumenC.unavailableNames.length === 1, JSON.stringify(resumenC.unavailableNames));
  const resumenA = await getQuoteItemsSummary([{ productId: producto.id, variantSku: A, quantity: 10 }]);
  check("cotizar con A: entra", resumenA.items.length === 1);

  const quoteDespues = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { items: true } });
  check(
    "cotizacion emitida con C: identica (sku y precio congelado)",
    quoteDespues.items.length === 1 && quoteDespues.items[0].variantSku === C && Number(quoteDespues.items[0].unitPrice) === 1234.56
  );

  console.log("\n=========== REACTIVACION ===========");
  await syncProduct(detalle(id, [A, B, C]));
  ({ porSku } = await variantes(id));
  check("C vuelve: se reactiva sola", porSku.get(C)?.active === true);

  console.log("\n=========== PRODUCTO SIN VARIANTES (caso 5699) ===========");
  const r3 = await syncProduct(detalle(id, []));
  ({ producto, porSku } = await variantes(id));
  check("cero variantes: producto INACTIVO", producto.active === false && r3.sinVariantes);
  check("cero variantes: las 3 variantes inactivas, ninguna borrada", porSku.size === 3 && [...porSku.values()].every((v) => !v.active));
  check("ficha: 404 (getProductById devuelve null)", (await getProductById(producto.id)) === null);
  await syncProduct(detalle(id, [A]));
  ({ producto, porSku } = await variantes(id));
  check("vuelve con una variante: producto activo de nuevo, solo A activa", producto.active && porSku.get(A)!.active && !porSku.get(B)!.active && !porSku.get(C)!.active);

  console.log("\n=========== GUARDA: pagina entera sin variantes (no escribe) ===========");
  const fetchOriginal = globalThis.fetch;
  const idsAnomalos = Array.from({ length: 6 }, (_, i) => `${PREFIJO}anomalo-${i}`);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/generic_product?")) {
      return Response.json({ count: 6, total_pages: 1, generic_products: idsAnomalos.map((x) => ({ id: x })) });
    }
    const pedido = idsAnomalos.find((x) => url.endsWith(`/generic_product/${x}`));
    if (pedido) return Response.json({ generic_product: detalle(pedido, []) });
    throw new Error(`Request inesperado: ${url}`);
  }) as typeof fetch;
  process.env.ZECAT_API_URL = "https://api-falsa.ejemplo.test/v1";
  process.env.ZECAT_API_TOKEN = "falso";
  let mensaje = "";
  try {
    await syncZecatBatch(1, 10);
  } catch (e) {
    mensaje = e instanceof Error ? e.message : String(e);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  const escritos = await prisma.product.count({ where: { zecatId: { in: idsAnomalos } } });
  check("tira 'Respuesta anómala'", mensaje.includes("Respuesta anómala de Zecat"), mensaje);
  check("no escribio NINGUN producto de esa pagina", escritos === 0, `escritos: ${escritos}`);

  console.log("\n=========== GUARDA: umbral de variantes en finishSyncRun (alerta) ===========");
  const yaCorriendo = await prisma.syncRun.findFirst({ where: { provider: ProductOrigin.ZECAT, status: SyncRunStatus.RUNNING } });
  if (yaCorriendo) {
    check("hay una corrida RUNNING en local: se saltea este caso", false);
  } else {
    // 40 productos con variante, que despues vienen vacios: supera el umbral
    // de productos (max(10, 5% de los activos locales)).
    const masivos = Array.from({ length: 40 }, (_, i) => `${PREFIJO}masivo-${i}`);
    for (const m of masivos) await syncProduct(detalle(m, [`${m}-v`]));
    const run = await acquireSyncRun(ProductOrigin.ZECAT, "audit-verify-variants");
    try {
      for (const m of masivos) await syncProduct(detalle(m, []));
      // Vistos = TODOS los zecat locales: asi no hay ausentes ni auto-pausado
      // de productos reales de la base local.
      const todos = await prisma.product.findMany({ where: { origin: ProductOrigin.ZECAT, zecatId: { not: null } }, select: { zecatId: true } });
      await recordBatch(run.id, {
        cursor: 1,
        counters: { created: 0, updated: 0, paused: 0, failed: 0, usdWarnings: 0 },
        seenExternalIds: todos.map((t) => t.zecatId!),
        errors: [],
      });
      const fin = await finishSyncRun(run.id);
      check("la corrida termina DONE", !fin.aborted && fin.run.status === SyncRunStatus.DONE);
      if (!fin.aborted) {
        check("cuenta los 40 productos sin variantes", fin.productosSinVariantes >= 40, String(fin.productosSinVariantes));
        check("cuenta las 40 variantes desactivadas (updatedAt renovado por updateMany)", fin.variantesDesactivadas >= 40, String(fin.variantesDesactivadas));
        check("no hubo ausentes ni auto-pausado de productos reales", (fin.run.missingExternalIds as string[]).length === 0);
      }
      check("salio la alerta de variantes", logs.some((l) => l.includes("asunto: Sync de Zecat:") && l.includes("variantes desactivadas")));
    } finally {
      await prisma.syncRun.delete({ where: { id: run.id } });
    }

    // Segunda corrida: los 40 siguen vacios. Es ESTADO, no transicion: no
    // tienen que volver a contarse ni disparar la alerta otra vez.
    const alertasAntes = logs.filter((l) => l.includes("variantes desactivadas")).length;
    const run2 = await acquireSyncRun(ProductOrigin.ZECAT, "audit-verify-variants");
    try {
      for (const m of masivos) await syncProduct(detalle(m, []));
      const todos = await prisma.product.findMany({ where: { origin: ProductOrigin.ZECAT, zecatId: { not: null } }, select: { zecatId: true } });
      await recordBatch(run2.id, {
        cursor: 1,
        counters: { created: 0, updated: 0, paused: 0, failed: 0, usdWarnings: 0 },
        seenExternalIds: todos.map((t) => t.zecatId!),
        errors: [],
      });
      const fin2 = await finishSyncRun(run2.id);
      check(
        "segunda corrida con los mismos vacios: 0 productos y 0 variantes nuevas",
        !fin2.aborted && fin2.productosSinVariantes === 0 && fin2.variantesDesactivadas === 0,
        fin2.aborted ? "abortada" : `${fin2.productosSinVariantes} / ${fin2.variantesDesactivadas}`
      );
      check("segunda corrida: NO repite la alerta", logs.filter((l) => l.includes("variantes desactivadas")).length === alertasAntes);
    } finally {
      await prisma.syncRun.delete({ where: { id: run2.id } });
    }
  }

  console.log("\n=========== CDO: desactivacion y guarda por transicion ===========");
  const foto = (n: number) => `https://cdn.ejemplo.test/cdo-${n}.jpg`;
  const probes = new Map<string, ImageProbe>(
    [1, 2, 3, 4].map((n) => [foto(n), { verdict: "ok", width: 800, height: 800 }])
  );
  const cdoProducto = (id: number, variantes: Array<{ vid: number; precio: string | null }>): CdoProduct => ({
    id,
    code: `A2T${id}`,
    name: `CDO prueba ${id}`,
    description: "Prueba A2",
    categories: [],
    icons: [],
    variants: variantes.map(({ vid, precio }) => ({
      id: vid,
      sku: `SKU${vid}`,
      stock_available: 50,
      stock_existent: 50,
      list_price: precio,
      net_price: precio,
      color: { id: vid, name: `Color ${vid}`, hex_code: null, picture: null },
      picture: { original: foto(vid) },
    })),
  });
  const resumen = { sinImagen: [], sinVariantes: [], iconosDesconocidos: [], variantesSinPrecio: [], skuSintetico: 0 } as unknown as CdoSyncSummary;
  const [c1] = CDO_IDS;
  await syncCdoProduct(cdoProducto(c1, [{ vid: 1, precio: "10" }, { vid: 2, precio: "12" }]), resumen, probes);
  let cdo = await prisma.product.findUniqueOrThrow({ where: { cdoId: String(c1) }, include: { variants: { orderBy: { sku: "asc" } } } });
  check("CDO: 2 variantes activas, producto activo", cdo.active && cdo.variants.filter((v) => v.active).length === 2);
  const rc = await syncCdoProduct(cdoProducto(c1, [{ vid: 1, precio: "10" }, { vid: 2, precio: null }]), resumen, probes);
  cdo = await prisma.product.findUniqueOrThrow({ where: { cdoId: String(c1) }, include: { variants: { orderBy: { sku: "asc" } } } });
  check("CDO: variante sin net_price queda inactiva, devuelve 1", rc.variantesDesactivadas === 1 && cdo.variants.filter((v) => v.active).length === 1 && cdo.active);
  await syncCdoProduct(cdoProducto(c1, []), resumen, probes);
  cdo = await prisma.product.findUniqueOrThrow({ where: { cdoId: String(c1) }, include: { variants: true } });
  check("CDO: sin variantes -> producto inactivo, ninguna borrada", !cdo.active && cdo.variants.length === 2 && cdo.variants.every((v) => !v.active));

  // Guarda: cuenta solo los que estan ACTIVOS hoy (transicion).
  const [, c2, c3] = CDO_IDS;
  await syncCdoProduct(cdoProducto(c2, [{ vid: 3, precio: "10" }]), resumen, probes);
  await syncCdoProduct(cdoProducto(c3, [{ vid: 4, precio: "10" }]), resumen, probes);
  const guarda = await vaciosQueSeApagarian([
    cdoProducto(c1, []), // ya inactivo: NO suma
    cdoProducto(c2, []), // activo y vacio: suma
    cdoProducto(c3, [{ vid: 4, precio: "10" }]), // con variante: NO suma
    cdoProducto(990000099, []), // no existe en la base: NO suma
  ]);
  check("guarda CDO: cuenta solo el activo que se apagaria", guarda.seApagarian === 1, String(guarda.seApagarian));
}

main()
  .catch((e) => {
    fallos++;
    console.error("TIRO:", e);
  })
  .finally(async () => {
    await limpiar();
    const quedan = await prisma.product.count({ where: { zecatId: { startsWith: PREFIJO } } });
    console.log(`\nLimpieza: ${quedan} productos de prueba quedan en la base (esperado 0).`);
    console.log(fallos ? `\n${fallos} chequeo(s) fallaron.` : "\nTodos los chequeos pasan.");
    if (fallos || quedan) process.exitCode = 1;
    await prisma.$disconnect();
  });

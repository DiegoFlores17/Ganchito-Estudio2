/// Exploracion de la API de PRODUCCION de CDO. SOLO LECTURA.
///
/// Este archivo NO importa Prisma a proposito: no puede escribir en ninguna
/// base aunque alguien lo corra por error con el DATABASE_URL equivocado.
/// Lo unico que hace es pedirle datos a la API de CDO y contar.
///
/// Se corre: `npx tsx scripts/explore-cdo-prod.ts`
///
/// Lee CDO_API_URL_PRODUCCION / CDO_API_TOKEN_PRODUCCION del .env y las inyecta en las
/// variables que espera el cliente. Las de pruebas (CDO_API_URL /
/// CDO_API_TOKEN) quedan intactas: `npm run sync:cdo` sigue apuntando a
/// pruebas mientras no se decida lo contrario.
import "dotenv/config";

const urlProd = process.env.CDO_API_URL_PRODUCCION;
const tokenProd = process.env.CDO_API_TOKEN_PRODUCCION;

if (!urlProd || !tokenProd) {
  console.error(
    "Faltan CDO_API_URL_PRODUCCION y/o CDO_API_TOKEN_PRODUCCION en el .env.\n" +
      "Se cargan como variables APARTE de las de pruebas, para que el sync no\n" +
      "cambie de entorno sin que nadie lo decida."
  );
  process.exit(1);
}

// Guarda: si la URL "de produccion" apunta al entorno de pruebas, lo que sigue
// no mide nada util y el reporte seria enganoso.
if (/dev\.yellowspot|preprod|staging/i.test(urlProd)) {
  console.error(`CDO_API_URL_PRODUCCION parece ser el entorno de PRUEBAS: ${urlProd}`);
  process.exit(1);
}

// El cliente lee estas dos en cada request (getConfig se llama por llamada, no
// al importar), asi que alcanza con pisarlas aca antes de usarlo.
process.env.CDO_API_URL = urlProd;
process.env.CDO_API_TOKEN = tokenProd;

import { fetchProductPage, iterateAllProducts } from "../src/lib/cdo/client";
import {
  candidateImageUrls,
  probeImage,
  splitIcons,
  buildSku,
  extractCostPrice,
  mapStock,
  type ImageProbe,
} from "../src/lib/cdo/normalize";
import type { CdoProduct } from "../src/lib/cdo/types";

/// Claves que ya conocemos del entorno de pruebas. Cualquier otra que aparezca
/// en produccion es un campo nuevo que el conector estaria ignorando.
const CLAVES_PRODUCTO = new Set([
  "id", "code", "name", "description", "categories", "icons", "packing", "variants",
]);
const CLAVES_VARIANTE = new Set([
  "id", "sku", "novedad", "stock_available", "stock_existent",
  "list_price", "net_price", "color", "picture", "detail_picture", "other_pictures",
]);

/// Las mismas dos listas que usa normalize.ts para clasificar. Se repiten acá
/// a proposito: normalize no las exporta, y el objetivo de este script es
/// justamente detectar los ids que NO estan en ellas.
const IDS_CONOCIDOS = new Set([
  11, 21, 31, 41, 51, 61, 62, 69, 70, 71, 76, 77, 78, 91, // tecnicas
  1, 63, 66, 67, 68, 74, 75, 80, 85, 87, 88,               // atributos
]);

function titulo(texto: string) {
  console.log(`\n${"=".repeat(72)}\n${texto}\n${"=".repeat(72)}`);
}

async function main() {
  console.log(`API de produccion: ${urlProd}`);

  // ---------------------------------------------------------------- 1
  titulo("1. ESTRUCTURA — una pagina, sin escribir nada");

  const primera = await fetchProductPage(1);
  const pag = primera.meta.pagination;
  console.log(
    `Pagina 1: ${primera.products.length} productos · ${pag.total_count} en total · ${pag.total_pages} paginas`
  );

  const clavesProdNuevas = new Set<string>();
  const clavesVarNuevas = new Set<string>();
  const clavesProdFaltantes = new Set(CLAVES_PRODUCTO);
  const tiposRaros: string[] = [];

  for (const p of primera.products) {
    for (const k of Object.keys(p)) {
      if (!CLAVES_PRODUCTO.has(k)) clavesProdNuevas.add(k);
      clavesProdFaltantes.delete(k);
    }
    for (const v of p.variants ?? []) {
      for (const k of Object.keys(v)) {
        if (!CLAVES_VARIANTE.has(k)) clavesVarNuevas.add(k);
      }
      // Los precios y el stock son los campos de los que depende el precio de
      // venta: si cambian de tipo, el conector escribe basura en silencio.
      if (v.net_price !== null && v.net_price !== undefined && typeof v.net_price !== "string") {
        tiposRaros.push(`net_price es ${typeof v.net_price} en variante ${v.id}`);
      }
      if (
        v.stock_available !== null && v.stock_available !== undefined &&
        typeof v.stock_available !== "number"
      ) {
        tiposRaros.push(`stock_available es ${typeof v.stock_available} en variante ${v.id}`);
      }
    }
  }

  console.log(
    `Campos NUEVOS en producto: ${clavesProdNuevas.size ? [...clavesProdNuevas].join(", ") : "ninguno"}`
  );
  console.log(
    `Campos NUEVOS en variante: ${clavesVarNuevas.size ? [...clavesVarNuevas].join(", ") : "ninguno"}`
  );
  console.log(
    `Campos que ya no vienen: ${clavesProdFaltantes.size ? [...clavesProdFaltantes].join(", ") : "ninguno"}`
  );
  console.log(`Tipos inesperados: ${tiposRaros.length ? tiposRaros.slice(0, 5).join(" · ") : "ninguno"}`);

  // Una muestra real, para poder mirarla a ojo.
  const muestra = primera.products[0];
  console.log("\nPrimer producto (recortado):");
  console.log(
    JSON.stringify(
      {
        id: muestra.id,
        code: muestra.code,
        name: muestra.name,
        categories: muestra.categories,
        icons: (muestra.icons ?? []).map((i) => ({ id: i.id, label: i.label })),
        variantes: (muestra.variants ?? []).length,
        primeraVariante: (muestra.variants ?? [])[0],
      },
      null,
      2
    ).slice(0, 1800)
  );

  // ---------------------------------------------------------------- 2
  titulo("2. VOLUMEN — bajando el catalogo entero (solo a memoria)");

  const productos: CdoProduct[] = [];
  for await (const p of iterateAllProducts()) productos.push(p);

  let variantes = 0;
  let sinPrecio = 0;
  let skuVacio = 0;
  let skusDuplicados = 0;
  const skusVistos = new Set<string>();
  const skuCrudo = new Map<string, number>();

  for (const p of productos) {
    for (const v of p.variants ?? []) {
      variantes++;
      if (!extractCostPrice(v)) sinPrecio++;
      const crudo = (v.sku ?? "").trim();
      if (!crudo) skuVacio++;
      else {
        skuCrudo.set(crudo, (skuCrudo.get(crudo) ?? 0) + 1);
      }
      const sku = buildSku(p.id, v);
      if (skusVistos.has(sku)) skusDuplicados++;
      skusVistos.add(sku);
      mapStock(v); // valida que no explote con los datos reales
    }
  }

  const crudosRepetidos = [...skuCrudo.values()].filter((n) => n > 1).length;

  console.log(`Productos:            ${productos.length}`);
  console.log(`Variantes:            ${variantes}`);
  console.log(`  sin precio usable:  ${sinPrecio} (se saltean al sincronizar)`);
  console.log(`  con sku vacio:      ${skuVacio} (se les sintetiza uno)`);
  console.log(`SKUs crudos repetidos entre productos: ${crudosRepetidos}`);
  console.log(
    `Colisiones DESPUES del prefijo cdo-{id}-: ${skusDuplicados} ${skusDuplicados === 0 ? "(bien)" : "(MAL — revisar)"}`
  );

  // ---------------------------------------------------------------- 3
  titulo("3. CATEGORIAS");

  const categorias = new Map<number, { name: string; productos: number }>();
  let sinCategoria = 0;
  for (const p of productos) {
    const primera = p.categories?.[0];
    if (!primera) {
      sinCategoria++;
      continue;
    }
    const actual = categorias.get(primera.id);
    if (actual) actual.productos++;
    else categorias.set(primera.id, { name: primera.name, productos: 1 });
  }

  // Las que ya existen en local, del entorno de pruebas.
  const YA_CONOCIDAS = new Set([
    "Carpetas, Bolsos y Mochilas", "Escritura", "Hogar", "Llaveros", "Ofertas",
    "Oficina y Negocios", "Paraguas", "Relojes y Calculadoras",
    "Salud y Cuidado personal", "Tecnología", "Tiempo Libre",
  ]);

  const ordenadas = [...categorias.entries()].sort((a, b) => b[1].productos - a[1].productos);
  console.log(`Categorias distintas (como PRIMERA de cada producto): ${categorias.size}`);
  console.log(`Productos sin categoria: ${sinCategoria}`);
  console.log("\n  productos  categoria");
  for (const [id, c] of ordenadas) {
    const marca = YA_CONOCIDAS.has(c.name) ? "   " : "NEW";
    console.log(`  ${marca} ${String(c.productos).padStart(5)}  ${c.name}  (id ${id})`);
  }

  // ---------------------------------------------------------------- 4
  titulo("4. ICONOS — cuales caerian en el default");

  const iconos = new Map<number, { label: string | null; usos: number }>();
  for (const p of productos) {
    for (const i of p.icons ?? []) {
      const actual = iconos.get(i.id);
      if (actual) actual.usos++;
      else iconos.set(i.id, { label: i.label, usos: 1 });
    }
    splitIcons(p.icons); // valida que no explote
  }

  const desconocidos = [...iconos.entries()].filter(([id]) => !IDS_CONOCIDOS.has(id));
  console.log(`Iconos distintos en produccion: ${iconos.size} (en pruebas eran 25)`);
  console.log(`SIN CLASIFICAR: ${desconocidos.length}`);
  if (desconocidos.length) {
    console.log("\n  Hay que agregarlos a mano a normalize.ts, decidiendo si son");
    console.log("  TECNICA DE IMPRESION o ATRIBUTO:\n");
    for (const [id, i] of desconocidos.sort((a, b) => b[1].usos - a[1].usos)) {
      console.log(`    id ${String(id).padStart(4)}  usos ${String(i.usos).padStart(4)}  ${i.label}`);
    }
  }

  // ---------------------------------------------------------------- 5
  titulo("5. CALIDAD DE PORTADAS");

  const portadas = productos
    .map((p) => ({ producto: p, url: candidateImageUrls(p)[0] }))
    .filter((x): x is { producto: CdoProduct; url: string } => !!x.url);

  const sinNingunaImagen = productos.length - portadas.length;
  console.log(
    `Midiendo ${portadas.length} portadas (${sinNingunaImagen} productos no tienen ninguna imagen ni siquiera candidata)...`
  );

  const resultado = { ok: 0, deforme: 0, chica: 0, rota: 0 };
  const LOTE = 12;
  for (let i = 0; i < portadas.length; i += LOTE) {
    const lote = portadas.slice(i, i + LOTE);
    const probes = await Promise.all(lote.map((x) => probeImage(x.url)));
    for (const probe of probes as ImageProbe[]) resultado[probe.verdict]++;
    if ((i / LOTE) % 10 === 0) {
      process.stdout.write(`\r  ${Math.min(i + LOTE, portadas.length)}/${portadas.length}`);
    }
  }
  process.stdout.write("\r");

  const malas = resultado.deforme + resultado.chica + resultado.rota;
  const total = resultado.ok + malas;
  const pct = total ? ((malas / total) * 100).toFixed(1) : "0";
  console.log(`\n  ok:        ${resultado.ok}`);
  console.log(`  deformes:  ${resultado.deforme}  (entran, con object-contain)`);
  console.log(`  chicas:    ${resultado.chica}  (se descartan)`);
  console.log(`  rotas:     ${resultado.rota}  (se descartan)`);
  console.log(`  ---`);
  console.log(`  ${malas} de ${total} con algun problema (${pct}%)`);
  console.log(`  En pruebas: 27 de 178 (15,2%)`);

  titulo("RESUMEN PARA DECIDIR");
  console.log(`Catalogo hoy en produccion:     553 productos (solo Zecat)`);
  console.log(`CDO produccion agregaria:       ${productos.length} productos`);
  console.log(`Total estimado:                 ${553 + productos.length}`);
  console.log(`Categorias nuevas de CDO:       ${categorias.size}`);
  console.log(`Iconos sin clasificar:          ${desconocidos.length}`);
  console.log(`Portadas con problema:          ${malas} (${pct}%)`);
}

main().catch((error) => {
  console.error("\nFallo la exploracion:", error);
  process.exit(1);
});

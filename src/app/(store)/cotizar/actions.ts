"use server";

import { QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  computePrintingPrice,
  computeSellPriceForQuantity,
  getPricingConfig,
} from "@/lib/pricing";
import { aCentavos, formatPriceArsCentavos } from "@/lib/format";
import { getVariantAvailableStock } from "@/lib/product";
import { sendQuoteNotification } from "@/lib/email";
import {
  getSiteConfig,
  normalizeWhatsappNumber,
  whatsappUrl,
} from "@/lib/site-config";
import {
  buildQuoteMessage,
  buildWaUrl,
  generateShortCode,
  type QuoteMessageLine,
} from "@/lib/quote-message";
import { Prisma } from "@prisma/client";
import { POLITICA_PRIVACIDAD_VERSION } from "@/lib/privacidad";
import { productosConRecargo } from "@/lib/quote-minimum";
import { lineasSobreElStock } from "@/lib/quote-stock";
import {
  etiquetaPublica,
  leerSeleccionesCrudas,
  tituloArea,
  opcionPorDefecto,
  resolverSeleccion,
  type OpcionInterna,
} from "@/lib/quote-printing";
import { impresionEnTotal, leyendaTotalMensaje } from "@/lib/leyendas-precio";
import {
  aCongelar,
  impresionDelProducto,
  SELECT_IMPRESION,
} from "@/lib/impresion-producto";
import {
  QUOTE_LOGO_EXTENSIONS,
  saveUploadedFile,
  UploadValidationError,
} from "@/lib/storage";

export interface QuoteCartItemInput {
  productId: string;
  variantSku?: string;
  quantity: number;
}

// Topes de la entrada publica. Las dos acciones de este archivo las puede
// invocar cualquiera que conozca el endpoint (una Server Action ES un
// endpoint): nada de lo que llega se considera bien formado por venir
// "de nuestro formulario".
const MAX_QUOTE_ITEMS = 50;
// Generoso a proposito: pedidos corporativos de miles de unidades existen.
// El tope corta el abuso (números absurdos que inflan la transaccion), no
// al cliente grande.
const MAX_QUANTITY_PER_LINE = 10_000;

/// Valida la forma de los items que llegan del cliente. Devuelve null si la
/// entrada no es un array valido; las lineas individualmente invalidas
/// (cantidad no entera, negativa, cero, o fuera de tope) se descartan.
function sanitizeItems(raw: unknown): QuoteCartItemInput[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_QUOTE_ITEMS) return null;

  const items: QuoteCartItemInput[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { productId, variantSku, quantity } = entry as Record<string, unknown>;
    if (typeof productId !== "string" || productId.length === 0) continue;
    if (variantSku !== undefined && typeof variantSku !== "string") continue;
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY_PER_LINE
    ) {
      continue;
    }
    items.push({ productId, variantSku, quantity });
  }
  return items;
}

/// Cantidad total por producto, sumando TODAS sus variantes.
///
/// Es lo que define el tramo de descuento del proveedor: verificado en el
/// backoffice de Zecat que un pedido de 50 talle S + 50 talle M cae en el
/// tramo de 100 unidades, no en el de 2. Usar la cantidad de la linea daria un
/// tramo mas caro que el que Zecat efectivamente cobra.
function sumarPorProducto(items: QuoteCartItemInput[]): Map<string, number> {
  const total = new Map<string, number>();
  for (const i of items) {
    total.set(i.productId, (total.get(i.productId) ?? 0) + i.quantity);
  }
  return total;
}

/// Nombres de los productos que quedaron afuera de una cotizacion, para
/// avisarle al cliente en pantalla en vez de descartar lineas en silencio.
/// Consulta SIN filtros de active/deletedAt a proposito: es solo lectura del
/// nombre para el aviso — el producto pausado o eliminado tiene nombre, y
/// "un producto" a secas no le dice nada al cliente.
async function getUnavailableNames(productIds: string[]): Promise<string[]> {
  if (productIds.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { name: true },
  });
  const names = rows.map((r) => r.name);
  const notFound = productIds.length - rows.length;
  // Filas que ya no existen fisicamente: no hay nombre que dar.
  for (let i = 0; i < notFound; i++) names.push("un producto eliminado");
  return names;
}

/// Personalizable: tiene al menos una tecnica (ProductPrintingType), tenga o
/// no precios. Mismo criterio que la leyenda de la card.
const SELECT_PERSONALIZABLE = {
  _count: { select: { printingTypes: true } },
} satisfies Prisma.ProductSelect;

/// Una opcion de personalizacion tal como la ve el cliente. Sin costos, sin la
/// etiqueta de Zecat y sin umbral: solo precio de venta y medidas.
export interface OpcionImpresion {
  key: string;
  zecatTypeId: string;
  zecatAreaId: string;
  technique: string;
  areaName: string;
  sizeLabel: string;
  unitPrice: number;
  setupPrice: number;
}

export interface ProductPrintingSummary {
  productId: string;
  productName: string;
  /// Total de unidades del producto (suma de sus lineas).
  quantity: number;
  opciones: OpcionImpresion[];
  /// Clave de la opcion elegida, o "ninguna". Si no habia nada guardado (o lo
  /// guardado ya no es una opcion), la preseleccionada: la mas chica.
  seleccion: string;
  /// Adicional del proveedor por cantidad chica para la cantidad ACTUAL del
  /// producto, o null si no corresponde. Viaja el MONTO, no el umbral. Ojo:
  /// probando cantidades (el resumen se puede pedir cuantas veces se quiera)
  /// el umbral se puede deducir, y se acepta — es inherente a mostrar el
  /// monto. Lo que no hacemos es publicarlo ni prometer personalizacion sin
  /// recargo. Se suma solo si el producto lleva personalizacion.
  surcharge: number | null;
}

export interface QuoteItemSummary {
  productId: string;
  productName: string;
  imageUrl: string | null;
  variantSku?: string;
  variantLabel: string | null;
  quantity: number;
  /// Unitario congelable (2 decimales) con centavos: "$ 1.272,23".
  unitPriceLabel: string;
  /// unitario x cantidad, exacto, en centavos enteros: el total se suma asi.
  subtotalCentavos: number;
  subtotalLabel: string;
  inStock: boolean;
  /// Tiene tecnicas de impresion. Si no aparece en `printing` (sin precios:
  /// CDO, o Zecat sin niveles), su personalizacion se cotiza aparte.
  personalizable: boolean;
}

export interface QuoteSummaryResult {
  items: QuoteItemSummary[];
  /// Nombres de productos del borrador que ya no se pueden cotizar
  /// (pausados o eliminados despues de que el cliente los agrego). La
  /// pantalla los muestra; descartarlos en silencio haria pensar al cliente
  /// que se olvido de agregarlos.
  unavailableNames: string[];
  /// Si hay numero de WhatsApp cargado en la config. La pagina lo necesita
  /// ANTES del submit: la ventana de WhatsApp se abre en el gesto del click
  /// (si no, Safari iOS la bloquea), y sin numero no hay que abrir nada.
  whatsappAvailable: boolean;
  /// Personalizacion ofrecida, un elemento por producto que tiene opciones.
  printing: ProductPrintingSummary[];
}

/// Resumen de los items del borrador para mostrar en /cotizar. Recalcula
/// el precio ACTUAL desde la base (nunca confia en nada de localStorage).
export async function getQuoteItemsSummary(
  rawItems: QuoteCartItemInput[],
  rawPrinting?: unknown
): Promise<QuoteSummaryResult> {
  const items = sanitizeItems(rawItems) ?? [];
  const selecciones = leerSeleccionesCrudas(rawPrinting);
  const siteConfig = await getSiteConfig();
  const whatsappAvailable = whatsappUrl(siteConfig.whatsappNumber) !== null;
  if (items.length === 0) {
    return { items: [], unavailableNames: [], whatsappAvailable, printing: [] };
  }

  const pricingConfig = await getPricingConfig();
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    // Solo productos VIVOS: un producto pausado o eliminado no se cotiza por
    // primera vez. (Las cotizaciones YA enviadas conservan sus items aunque
    // el producto muera despues — eso es el soft delete y no pasa por aca.)
    where: { id: { in: productIds }, active: true, deletedAt: null },
    include: {
      ...SELECT_IMPRESION,
      ...SELECT_PERSONALIZABLE,
      images: {
        where: { variantId: null },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
        take: 1,
      },
      variants: {
        // Solo ACTIVAS: un sku que el proveedor dejo de mandar se trata igual
        // que uno que no existe — la linea se omite y va al aviso.
        where: { active: true },
        select: {
          sku: true,
          colorName: true,
          sizeName: true,
          stock: true,
          reservedStock: true,
          costPrice: true,
          // Lo necesita computeSellPriceForQuantity: el precio depende del
          // escalon de ESTA variante que corresponda a la cantidad.
          discountPercent: true,
          discountTiers: true,
        },
      },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const summaries: QuoteItemSummary[] = [];
  const unavailableIds = new Set<string>();
  // El tramo de descuento se elige por el total del producto, y ese total se
  // calcula en DOS pasadas: primero se resuelven las lineas que sobreviven
  // (producto vivo, variante activa, sku presente) y recien despues se suma
  // por producto. Sumar todo lo enviado inflaba el tramo con lineas que
  // despues se omiten (ej: 1 valida + 1000 de un sku inexistente cobraba el
  // tramo de 1001 una sola unidad). El resumen y la cotizacion congelada
  // usan el mismo criterio para que muestren lo mismo.
  const vivas: Array<{
    item: QuoteCartItemInput;
    product: (typeof products)[number];
    variant: (typeof products)[number]["variants"][number];
  }> = [];
  for (const item of items) {
    const product = byId.get(item.productId);
    // Quedo afuera del filtro (pausado/eliminado) o no existe: va al aviso.
    if (!product) {
      unavailableIds.add(item.productId);
      continue;
    }

    const variant = item.variantSku
      ? product.variants.find((v) => v.sku === item.variantSku)
      : undefined;

    // El precio sale de la VARIANTE. Si el carrito trae un sku que ya no
    // existe, se omite la linea en vez de cobrar el precio de otra variante:
    // mostrarle al cliente un precio que no corresponde a lo que eligio es
    // peor que no mostrarle la linea. Va al aviso igual que un producto
    // muerto: para el cliente es lo mismo, "esto ya no esta".
    if (!variant) {
      unavailableIds.add(item.productId);
      continue;
    }

    vivas.push({ item, product, variant });
  }
  const totalPorProducto = sumarPorProducto(vivas.map((v) => v.item));

  for (const { item, product, variant } of vivas) {
    const sellPrice = computeSellPriceForQuantity(
      variant,
      product.currency,
      pricingConfig,
      totalPorProducto.get(item.productId) ?? item.quantity
    );
    const unitPrice = aCongelar(sellPrice);
    const subtotal = unitPrice.times(item.quantity);

    summaries.push({
      productId: product.id,
      productName: product.name,
      imageUrl: product.images[0]?.url ?? null,
      variantSku: item.variantSku,
      variantLabel:
        [variant?.colorName, variant?.sizeName].filter(Boolean).join(" / ") ||
        null,
      quantity: item.quantity,
      unitPriceLabel: formatPriceArsCentavos(unitPrice),
      subtotalCentavos: aCentavos(subtotal),
      subtotalLabel: formatPriceArsCentavos(subtotal),
      inStock: getVariantAvailableStock(variant) > 0,
      personalizable: product._count.printingTypes > 0,
    });
  }

  // Personalizacion: una entrada por producto que sobrevivio y tiene
  // opciones. El precio sale de la MISMA funcion y con los MISMOS datos que
  // congela submitQuote. Del recargo viaja solo el monto; el umbral se queda
  // aca.
  const printing: ProductPrintingSummary[] = [];
  for (const [productId, quantity] of totalPorProducto) {
    const product = byId.get(productId)!;
    const { opciones, costoPorNivel } = impresionDelProducto(product);
    if (opciones.length === 0) continue;
    const resuelta = resolverSeleccion(opciones, selecciones[productId]);
    const seleccion =
      resuelta.tipo === "ok"
        ? resuelta.opcion.key
        : resuelta.tipo === "ninguna"
          ? "ninguna"
          : opcionPorDefecto(opciones)!.key;
    const recargo = computePrintingPrice(
      { unitCost: new Prisma.Decimal(0), setupCost: new Prisma.Decimal(0) },
      pricingConfig,
      {
        productQuantity: quantity,
        minOrderQuantity: product.minOrderQuantity,
        underMinimumCost: product.printingUnderMinimumCost,
      }
    ).surcharge;
    printing.push({
      productId,
      productName: product.name,
      quantity,
      seleccion,
      surcharge: recargo === null ? null : Number(recargo),
      opciones: opciones.map((o) => {
        const precio = computePrintingPrice(costoPorNivel.get(o.zecatTypeId)!, pricingConfig);
        return {
          key: o.key,
          zecatTypeId: o.zecatTypeId,
          zecatAreaId: o.zecatAreaId,
          technique: o.technique,
          areaName: tituloArea(o.areaName),
          sizeLabel: o.sizeLabel,
          unitPrice: Number(precio.unitPrice),
          setupPrice: Number(precio.setupPrice),
        };
      }),
    });
  }

  return {
    items: summaries,
    unavailableNames: await getUnavailableNames([...unavailableIds]),
    whatsappAvailable,
    printing,
  };
}

export interface SubmitQuoteResult {
  success: boolean;
  error?: string;
  quoteId?: string;
  /// Productos que quedaron afuera al congelar precios (pausados o
  /// eliminados entre que el cliente armo el pedido y lo envio). La
  /// pantalla de confirmacion los muestra.
  omittedProducts?: string[];
  /// Link wa.me con el pedido pre-armado, o null si no hay numero de
  /// WhatsApp cargado en la config. Es un EXTRA: la cotizacion ya esta
  /// guardada cuando esto se arma, y si WhatsApp falla no se pierde nada.
  waUrl?: string | null;
  shortCode?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/// El telefono es OPCIONAL, pero si viene tiene que ser plausible: un
/// numero mal cargado es peor que ninguno — Ganchito llama, no entra, y
/// nadie se entera de por que. Caso real: el autocompletado de un navegador
/// concateno digitos de otro campo y guardamos 3512350995083.
///
/// Se validan solo los DIGITOS (el cliente escribe como quiere: espacios,
/// guiones, parentesis, +54).
///
/// LO QUE NO FUNCIONO, para que nadie lo reintente:
/// - Un rango generico 8..15: 3512350995083 son 13 digitos y +54 9 351
///   235-0995 tambien — el roto y el valido tienen el MISMO largo.
/// - Exigir prefijo de pais con una lista: el numero roto empieza con
///   "351", que es un codigo real (Portugal), asi que entraba igual. Peor:
///   "123" pasaba por el "1" de Norteamerica.
///
/// La regla que SI separa los casos: los numeros de 12+ digitos solo son
/// validos con el prefijo de pais ESCRITO EXPLICITAMENTE por el cliente
/// (un "+" adelante, o "00"). Nadie tipea un internacional sin el "+"; el
/// autocompletado, en cambio, pega digitos crudos. Un numero largo sin "+"
/// es basura concatenada.
// 10 digitos nacionales + UN prefijo: el 0 de larga distancia ("0351
// 235-0995" = 11) o el 15 de celular ("351 15 235-0995" = 12). Los dos
// juntos ("0351 15 235-0995" = 13) no es una forma correcta de marcar, y
// justamente 13 es el largo del numero roto que motivo esto: no hay forma
// de distinguirlos por largo, asi que el corte queda en 12.
const MAX_DIGITOS_NACIONALES = 12;

function telefonoPlausible(raw: string): boolean {
  const digitos = raw.replace(/\D/g, "");
  if (digitos.length < 8 || digitos.length > 15) return false;
  if (digitos.length <= MAX_DIGITOS_NACIONALES) return true;
  // 13 a 15 digitos: solo si el cliente escribio el prefijo internacional.
  return /^\s*(\+|00)/.test(raw);
}

export async function submitQuote(
  formData: FormData
): Promise<SubmitQuoteResult> {
  const customerName = String(formData.get("customerName") ?? "").trim();
  const customerEmail = String(formData.get("customerEmail") ?? "").trim();
  const customerPhone =
    String(formData.get("customerPhone") ?? "").trim() || null;
  const companyName = String(formData.get("companyName") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const itemsRaw = String(formData.get("items") ?? "[]");
  const printingRaw = String(formData.get("printing") ?? "{}");
  const logo = formData.get("logo");
  // Un checkbox marcado llega como "on"; sin marcar, no llega.
  const privacyAccepted = formData.get("privacyAccepted") === "on";

  if (!customerName) {
    return { success: false, error: "Falta el nombre." };
  }
  if (!customerEmail || !EMAIL_REGEX.test(customerEmail)) {
    return { success: false, error: "El email no es válido." };
  }
  if (customerPhone && !telefonoPlausible(customerPhone)) {
    return {
      success: false,
      error:
        "El teléfono no parece válido. Si es de Argentina, escribilo sin el código de país (ej: 351 235-0995); si es del exterior, empezá con + y el código.",
    };
  }
  // Antes de subir el logo y de tocar la base: sin aceptacion no se guarda
  // ningun dato del cliente, tampoco su archivo. El `required` del checkbox
  // no alcanza — esta accion se puede llamar sin pasar por el formulario.
  if (!privacyAccepted) {
    return {
      success: false,
      error: "Para enviar la solicitud tenés que aceptar la Política de privacidad.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(itemsRaw);
  } catch {
    return {
      success: false,
      error: "No se pudieron leer los productos de la cotización.",
    };
  }

  // La validacion de forma va ANTES de tocar la base o subir el logo: una
  // cantidad negativa, decimal, o un array gigante no tienen que llegar ni
  // a la consulta. sanitizeItems descarta las lineas invalidas y rechaza el
  // array entero si excede el tope.
  if (!Array.isArray(parsed)) {
    return {
      success: false,
      error: "No se pudieron leer los productos de la cotización.",
    };
  }
  // La personalizacion no rechaza nunca: un JSON roto equivale a "no vino
  // nada" (cada producto se cotiza sin personalizar, sin marca).
  let selecciones: Record<string, unknown> = {};
  try {
    selecciones = leerSeleccionesCrudas(JSON.parse(printingRaw));
  } catch {
    selecciones = {};
  }

  const items = sanitizeItems(parsed);
  if (items === null) {
    return {
      success: false,
      error: `La cotización admite hasta ${MAX_QUOTE_ITEMS} productos.`,
    };
  }
  if (items.length === 0) {
    return {
      success: false,
      error: "Agregá al menos un producto antes de enviar.",
    };
  }

  // Precio CONGELADO al momento de cotizar: se recalcula server-side desde el
  // costo + margen + cotizacion actuales, nunca se confia en un precio que
  // venga del cliente (pudo haber sido manipulado antes de enviarse).
  //
  // El costo ahora vive en la VARIANTE, asi que la busqueda es por
  // (productId, variantSku) y no solo por producto: dos variantes del mismo
  // producto pueden valer distinto, y cobrar la de al lado seria cobrarle al
  // cliente un precio que nunca vio.
  const pricingConfig = await getPricingConfig();
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    // Solo productos VIVOS: pausado o eliminado no se cotiza por primera
    // vez. Ojo con la distincion: las cotizaciones YA enviadas conservan sus
    // items aunque el producto muera despues (soft delete + bloqueo de FK,
    // verificado) — este filtro solo cubre el momento de CREAR una nueva.
    where: { id: { in: productIds }, active: true, deletedAt: null },
    select: {
      id: true,
      // name y los labels de variante son para el MENSAJE de WhatsApp, no
      // para el precio.
      name: true,
      currency: true,
      minOrderQuantity: true,
      // Recargo de Zecat por personalizar debajo del umbral, para congelarlo
      // en QuotePrinting. Al cliente se le mostro el monto en el resumen.
      printingUnderMinimumCost: true,
      ...SELECT_IMPRESION,
      ...SELECT_PERSONALIZABLE,
      variants: {
        // Mismo criterio que el resumen: un sku desactivado (el proveedor ya
        // no lo manda) no se cotiza — la linea se omite como si no existiera.
        where: { active: true },
        select: {
          sku: true,
          // Stock para la marca interna de "pedido mayor al stock" (mail a
          // Ganchito). No se usa para bloquear nada.
          stock: true,
          reservedStock: true,
          costPrice: true,
          discountPercent: true,
          discountTiers: true,
          colorName: true,
          sizeName: true,
        },
      },
    },
  });

  const productoPorId = new Map(products.map((p) => [p.id, p]));

  const quoteItemsData: Array<{
    productId: string;
    variantSku: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    minOrderQuantity: number | null;
    printingType: string | null;
  }> = [];
  const messageLines: QuoteMessageLine[] = [];
  // Stock disponible de cada sku que entro, para marcar en el mail los pedidos
  // que lo superan. Sale del mismo producto ya leido: no hay otra consulta.
  const disponiblePorSku = new Map<string, number>();
  const omitidos: string[] = [];
  const omitidosIds = new Set<string>();
  // El tramo de descuento se elige por el total del producto, y ese total se
  // calcula en DOS pasadas: primero se resuelven las lineas que sobreviven
  // (producto vivo, variante activa, sku presente) y recien despues se suma
  // por producto. Sumar todo lo enviado inflaba el tramo con lineas que
  // despues se omiten (ej: 1 valida + 1000 de un sku inexistente cobraba el
  // tramo de 1001 una sola unidad). El resumen y la cotizacion congelada
  // usan el mismo criterio para que muestren lo mismo.
  const vivas: Array<{
    item: QuoteCartItemInput;
    product: (typeof products)[number];
    variant: (typeof products)[number]["variants"][number];
  }> = [];
  for (const item of items) {
    const product = productoPorId.get(item.productId);
    // Pausado, eliminado, o directamente inexistente: no entra.
    if (!product) {
      omitidos.push(`producto ${item.productId} no disponible`);
      omitidosIds.add(item.productId);
      continue;
    }

    // Sin variantSku no hay forma de saber que precio corresponde. Antes esto
    // funcionaba porque el precio era del producto; ahora no: se omite la
    // linea en vez de adivinar (nunca se cobra con la variante de al lado).
    const variant = item.variantSku
      ? product.variants.find((v) => v.sku === item.variantSku)
      : undefined;

    if (!variant) {
      omitidos.push(
        item.variantSku
          ? `variante ${item.variantSku} del producto ${item.productId} ya no existe`
          : `linea sin variantSku del producto ${item.productId}`
      );
      omitidosIds.add(item.productId);
      continue;
    }

    vivas.push({ item, product, variant });
  }
  const totalPorProducto = sumarPorProducto(vivas.map((v) => v.item));

  // Personalizacion, por PRODUCTO (el setup y el recargo son por producto).
  // Se revalida contra las opciones de la base: lo que no es una opcion de
  // ese producto se quita y se marca, nunca se rechaza la cotizacion.
  const printingData: Array<{
    productId: string;
    opcion: OpcionInterna;
    publicLabel: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    setupPrice: Prisma.Decimal;
    surcharge: Prisma.Decimal | null;
  }> = [];
  const descartadas: string[] = [];
  for (const [productId, quantity] of totalPorProducto) {
    const product = productoPorId.get(productId)!;
    const { opciones, costoPorNivel } = impresionDelProducto(product);
    const resuelta = resolverSeleccion(opciones, selecciones[productId]);
    if (resuelta.tipo === "invalida") {
      descartadas.push(productId);
      continue;
    }
    if (resuelta.tipo !== "ok") continue;
    const precio = computePrintingPrice(
      costoPorNivel.get(resuelta.opcion.zecatTypeId)!,
      pricingConfig,
      {
        productQuantity: quantity,
        minOrderQuantity: product.minOrderQuantity,
        underMinimumCost: product.printingUnderMinimumCost,
      }
    );
    printingData.push({
      productId,
      opcion: resuelta.opcion,
      publicLabel: etiquetaPublica(resuelta.opcion),
      quantity,
      ...precio,
    });
  }
  if (descartadas.length > 0) {
    console.warn(
      `[cotizar] Seleccion de personalizacion invalida, se quito en ${descartadas.length} producto(s): ${descartadas.join(", ")}`
    );
  }
  const etiquetaPorProducto = new Map(printingData.map((p) => [p.productId, p.publicLabel]));

  for (const { item, product, variant } of vivas) {
    const unitPrice = aCongelar(
      computeSellPriceForQuantity(
        variant,
        product.currency,
        pricingConfig,
        totalPorProducto.get(item.productId) ?? item.quantity
      )
    );

    quoteItemsData.push({
      productId: item.productId,
      // Siempre hay sku aca: sin sku la linea se omitio arriba.
      variantSku: variant.sku,
      quantity: item.quantity,
      unitPrice,
      // Snapshot del umbral de personalizacion sin recargo del proveedor. No
      // se rechaza por esto: es una cotizacion, no una venta, y rebotarla
      // pierde el contacto. Solo se marca para Ganchito (ver
      // lib/quote-minimum.ts).
      minOrderQuantity: product.minOrderQuantity,
      // Etiqueta publica de la personalizacion del producto (la misma en
      // todas sus lineas). Null sin personalizar.
      printingType: etiquetaPorProducto.get(item.productId) ?? null,
    });

    // La linea del mensaje de WhatsApp se arma ACA, con los mismos valores
    // que se congelan — no se recalcula nada al armar el texto.
    disponiblePorSku.set(variant.sku, getVariantAvailableStock(variant));

    messageLines.push({
      productName: product.name,
      variantLabel:
        [variant.colorName, variant.sizeName].filter(Boolean).join(" / ") ||
        null,
      printingType: etiquetaPorProducto.get(item.productId) ?? null,
      quantity: item.quantity,
      subtotal: Number(unitPrice.times(item.quantity)),
    });
  }

  // Si se cayo alguna linea queda en el log del server (con ids, para
  // diagnostico) Y se le avisa al cliente en pantalla (con nombres, via
  // omittedProducts): sacarle un item sin decirle nada le haria pensar que
  // se olvido de agregarlo.
  if (omitidos.length > 0) {
    console.warn(
      `[cotizar] Se omitieron ${omitidos.length} linea(s) al congelar precios: ${omitidos.join("; ")}`
    );
  }

  // Rechazo ANTES de subir el logo y de tocar la base: una cotizacion sin
  // lineas no se crea, y el archivo del cliente tampoco se guarda. Vale para
  // cualquier causa (producto muerto, sku inexistente o inactivo, linea sin
  // sku): el caso es el mismo.
  if (quoteItemsData.length === 0) {
    return {
      success: false,
      error: "Ninguno de los productos de la cotización está disponible.",
    };
  }

  // El logo es opcional: el cliente puede cotizar sin subir el arte todavia.
  let logoUrl: string | null = null;
  if (logo instanceof File && logo.size > 0) {
    try {
      logoUrl = await saveUploadedFile(logo, {
        subdir: "quotes",
        allowedExtensions: QUOTE_LOGO_EXTENSIONS,
      });
    } catch (error) {
      if (error instanceof UploadValidationError) {
        return { success: false, error: error.message };
      }
      throw error;
    }
  }

  const omittedProducts = await getUnavailableNames([...omitidosIds]);

  // Productos cuyo total (suma de sus lineas que entraron) queda debajo del
  // umbral sin recargo del proveedor. Por PRODUCTO y no por linea, igual que
  // /cotizar.
  const conRecargo = productosConRecargo(quoteItemsData);
  // Lineas cuyo pedido supera el stock del ultimo sync (por sku). Interno.
  const sobreElStock = lineasSobreElStock(quoteItemsData, disponiblePorSku);

  // shortCode con retry: 31^6 combinaciones hacen el choque rarisimo, pero
  // "rarisimo" con clientes reales es "algun dia". Ante P2002 se regenera y
  // se reintenta; cualquier otro error sube normal.
  let quote: { id: string; shortCode: string } | null = null;
  for (let intento = 0; intento < 5 && !quote; intento++) {
    try {
      quote = await prisma.quote.create({
        data: {
          status: QuoteStatus.SUBMITTED,
          shortCode: generateShortCode(),
          customerName,
          customerEmail,
          customerPhone,
          companyName,
          logoUrl,
          notes,
          // Fecha del servidor y version de la constante: nada de lo que
          // diga el cliente sobre cuando o que acepto.
          privacyAcceptedAt: new Date(),
          privacyVersion: POLITICA_PRIVACIDAD_VERSION,
          items: { create: quoteItemsData },
          printings: {
            create: printingData.map((p) => ({
              productId: p.productId,
              zecatTypeId: p.opcion.zecatTypeId,
              technique: p.opcion.technique,
              levelLabel: p.opcion.levelLabel,
              publicLabel: p.publicLabel,
              areaName: p.opcion.areaName,
              quantity: p.quantity,
              unitPrice: p.unitPrice,
              setupPrice: p.setupPrice,
              surcharge: p.surcharge,
              estimated: true,
            })),
          },
          printingDroppedProductIds: descartadas,
        },
        select: { id: true, shortCode: true },
      });
    } catch (error) {
      const esColision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
      if (!esColision || intento === 4) throw error;
    }
  }
  if (!quote) {
    // Inalcanzable (el loop tira o asigna), pero TypeScript no lo sabe.
    throw new Error("No se pudo crear la cotización.");
  }

  // El link de WhatsApp se arma DESPUES de guardar: es un extra para
  // acelerar el contacto, no un punto de falla del flujo. Si no hay numero
  // cargado, waUrl queda null y la pantalla muestra la confirmacion normal.
  //
  // El total es SIEMPRE la suma de (unitPrice congelado x cantidad) de las
  // lineas que ENTRARON — las omitidas no se cobran ni se suman.
  // Una sola lectura para los dos usos que vienen: el link de WhatsApp y
  // el destino del aviso por mail.
  const siteConfig = await getSiteConfig();

  // Total que vio el cliente: productos + personalizacion (unitario congelado
  // x cantidad) + preparacion del logo + adicional por cantidad chica.
  // Se suma en centavos: el total es EXACTAMENTE la suma de las lineas
  // mostradas (cada una ya es monto congelado x cantidad).
  const totalCentavos =
    messageLines.reduce((sum, l) => sum + aCentavos(l.subtotal), 0) +
    printingData.reduce(
      (sum, p) =>
        sum +
        aCentavos(p.unitPrice.times(p.quantity)) +
        aCentavos(p.setupPrice) +
        aCentavos(p.surcharge ?? 0),
      0
    );
  const total = totalCentavos / 100;
  // Personalizables sin precio (CDO, Zecat sin niveles): su personalizacion
  // se cotiza aparte. Los "Sin personalizar" elegidos a proposito no.
  const sinPrecio = [...totalPorProducto.keys()].filter((id) => {
    const product = productoPorId.get(id)!;
    return (
      product._count.printingTypes > 0 &&
      impresionDelProducto(product).opciones.length === 0
    );
  }).length;
  const sufijoTotal = leyendaTotalMensaje(
    impresionEnTotal({ conImpresion: printingData.length, sinPrecio })
  );
  const conPersonalizacion = new Set(printingData.map((p) => p.productId));
  const nombrePorProducto = new Map(products.map((p) => [p.id, p.name]));

  let waUrl: string | null = null;
  const waDigits = siteConfig.whatsappNumber
    ? normalizeWhatsappNumber(siteConfig.whatsappNumber)
    : "";
  if (waDigits) {
    const message = buildQuoteMessage({
      shortCode: quote.shortCode,
      customerName,
      companyName,
      customerEmail,
      lines: messageLines,
      total,
      sufijoTotal,
      formatPrice: (v) => formatPriceArsCentavos(v),
    });
    waUrl = buildWaUrl(waDigits, message);
  }

  // Aviso al equipo. Va DESPUES de guardar y con await —para que el server
  // no se apague antes de mandarlo, que en serverless pasa si se deja
  // colgado— pero sendQuoteNotification NUNCA tira: si Resend falla, loguea
  // y devuelve false. El cliente ya tiene su cotizacion guardada y no se
  // entera de nada.
  //
  // Destino: SiteConfig.contactEmail, editable desde el panel — un aviso de
  // cotizacion es negocio, no configuracion tecnica (las alertas del sync
  // van a ALERT_EMAIL, que es otra cosa).
  if (siteConfig.contactEmail) {
    await sendQuoteNotification({
      quoteId: quote.id,
      shortCode: quote.shortCode,
      customerName,
      customerEmail,
      customerPhone,
      companyName,
      notes,
      logoUrl,
      lines: messageLines.map((l, i) => ({
        productName: l.productName,
        variantLabel: l.variantLabel,
        quantity: l.quantity,
        // Solo el mail a Ganchito lleva las marcas; el mensaje de WhatsApp
        // (messageLines) no.
        sinRecargoDesde: conRecargo.get(quoteItemsData[i].productId) ?? null,
        conPersonalizacion: conPersonalizacion.has(quoteItemsData[i].productId),
        stockDisponible: sobreElStock[i],
        unitPriceLabel: formatPriceArsCentavos(quoteItemsData[i].unitPrice),
        subtotalLabel: formatPriceArsCentavos(l.subtotal),
      })),
      printing: printingData.map((p) => ({
        productName: nombrePorProducto.get(p.productId) ?? p.productId,
        publicLabel: p.publicLabel,
        levelLabel: p.opcion.levelLabel,
        quantity: p.quantity,
        unitPriceLabel: formatPriceArsCentavos(p.unitPrice),
        subtotalLabel: formatPriceArsCentavos(p.unitPrice.times(p.quantity)),
        setupLabel: formatPriceArsCentavos(p.setupPrice),
        surchargeLabel: p.surcharge ? formatPriceArsCentavos(p.surcharge) : null,
        sinRecargoDesde: p.surcharge ? conRecargo.get(p.productId) ?? null : null,
      })),
      droppedPrintingNames: descartadas.map((id) => nombrePorProducto.get(id) ?? id),
      totalLabel: formatPriceArsCentavos(total),
      sufijoTotal,
      to: siteConfig.contactEmail,
    });
  } else {
    console.warn(
      `[cotizar] Cotización ${quote.shortCode} guardada pero SIN aviso por mail: no hay contactEmail cargado en el panel.`
    );
  }

  return {
    success: true,
    quoteId: quote.id,
    omittedProducts,
    waUrl,
    shortCode: quote.shortCode,
  };
}

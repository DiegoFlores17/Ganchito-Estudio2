// Borrador de cotizacion en localStorage: todavia no hay carrito/sesion en
// la base, y no hace falta uno para esto (es solo el estado previo a
// enviar la solicitud). No confiar en nada de aca para precios: se
// recalculan siempre server-side antes de mostrar o guardar nada.

export interface QuoteCartItem {
  productId: string;
  variantSku?: string;
  quantity: number;
}

const STORAGE_KEY = "ganchito:cotizacion";

/// Personalizacion elegida en /cotizar, por producto. Va en una clave APARTE y
/// no dentro de las lineas: la seleccion es por producto (el setup y el
/// recargo tambien), mientras que las lineas son por variante, y el formato de
/// `ganchito:cotizacion` lo leen la ficha y el header. Un carrito sin esta
/// clave (anterior a la tanda 4b) se cotiza sin personalizacion.
///
/// Valor por producto: { zecatTypeId, zecatAreaId }, o "ninguna" si el cliente
/// eligio no personalizar. Un producto sin entrada usa la opcion por defecto.
const PRINTING_KEY = "ganchito:cotizacion:impresion";

export type QuotePrintingChoice =
  | { zecatTypeId: string; zecatAreaId: string }
  | "ninguna";

// localStorage no dispara su evento "storage" en la misma pestana que hizo
// el cambio (solo en las otras pestanas abiertas). El header necesita
// enterarse en la MISMA pestana cuando se agrega/saca un item, asi que
// disparamos este evento propio en cada escritura.
export const QUOTE_CART_EVENT = "ganchito:quote-cart-updated";

function readRaw(): QuoteCartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(items: QuoteCartItem[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(QUOTE_CART_EVENT));
}

export function getQuoteCart(): QuoteCartItem[] {
  return readRaw();
}

/// Si ya existe una linea con el mismo producto+variante, suma la
/// cantidad en vez de agregar una linea duplicada.
export function addToQuoteCart(item: QuoteCartItem): QuoteCartItem[] {
  const items = readRaw();
  const existingIndex = items.findIndex(
    (i) => i.productId === item.productId && i.variantSku === item.variantSku
  );

  if (existingIndex >= 0) {
    items[existingIndex] = {
      ...items[existingIndex],
      quantity: items[existingIndex].quantity + item.quantity,
    };
  } else {
    items.push(item);
  }

  writeRaw(items);
  return items;
}

/// Reemplaza el borrador entero. Lo usa /cotizar cuando el resumen del
/// servidor descarto lineas (productos pausados/eliminados): el carrito
/// guardado tiene que quedar igual al resumen que se muestra, porque
/// removeFromQuoteCart borra POR INDICE — si el resumen es mas corto que el
/// carrito, los indices se corren y "Quitar" borraria la linea equivocada.
export function replaceQuoteCart(items: QuoteCartItem[]): QuoteCartItem[] {
  writeRaw(items);
  return items;
}

export function removeFromQuoteCart(index: number): QuoteCartItem[] {
  const items = readRaw();
  items.splice(index, 1);
  writeRaw(items);
  return items;
}

export function clearQuoteCart(): void {
  writeRaw([]);
  try {
    window.localStorage.removeItem(PRINTING_KEY);
  } catch {
    // Sin storage no hay nada que limpiar.
  }
}

/// Selecciones guardadas. Tolera la clave ausente o un JSON roto (vacio).
export function getQuotePrinting(): Record<string, QuotePrintingChoice> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(PRINTING_KEY) ?? "{}"
    );
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, QuotePrintingChoice>)
      : {};
  } catch {
    return {};
  }
}

export function setQuotePrinting(
  productId: string,
  choice: QuotePrintingChoice
): void {
  if (typeof window === "undefined") return;
  try {
    const actual = getQuotePrinting();
    actual[productId] = choice;
    window.localStorage.setItem(PRINTING_KEY, JSON.stringify(actual));
  } catch {
    // Sin storage la eleccion vale para esta pantalla y se pierde al recargar.
  }
}

/// Suscripcion al carrito para `useSyncExternalStore`: cubre la misma pestana
/// (evento propio) y las otras (evento nativo "storage").
export function subscribeQuoteCart(onChange: () => void): () => void {
  window.addEventListener(QUOTE_CART_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(QUOTE_CART_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/// El carrito CRUDO (string). `useSyncExternalStore` compara snapshots con
/// Object.is: devolver un array nuevo en cada lectura loopearia, un string
/// igual no.
export function getQuoteCartSnapshot(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

/// Cantidad ya guardada en el carrito, por sku, de UN producto. Ignora lineas
/// sin sku, de otros productos y cantidades que no son un numero. Tolera un
/// JSON roto (devuelve vacio).
export function cantidadesEnCarritoPorSku(
  raw: string,
  productId: string
): Record<string, number> {
  const porSku: Record<string, number> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return porSku;
    for (const item of parsed) {
      if (!item || item.productId !== productId || !item.variantSku) continue;
      const n = Number(item.quantity);
      if (!Number.isFinite(n) || n <= 0) continue;
      porSku[item.variantSku] = (porSku[item.variantSku] ?? 0) + n;
    }
  } catch {
    // JSON roto: sin cantidades.
  }
  return porSku;
}

/// Lineas que el boton "Agregar a mi cotizacion" de la ficha va a agregar,
/// ANTES del recorte final contra el carrito de ese momento. Es la UNICA
/// fuente de esas lineas: la usan el boton y el total estimado de la ficha,
/// asi el recuadro nunca suma algo distinto de lo que se agrega.
///
/// - Producto con color/talle: las combinaciones ya armadas (el selector de
///   cantidad todavia no es una linea hasta "+ Agregar combinacion").
/// - Producto sin variantes a elegir: lo del selector, topeado al cupo.
export function lineasPorAgregar({
  conVariantes,
  combinaciones,
  sku,
  cantidad,
  cupo,
}: {
  conVariantes: boolean;
  combinaciones: Array<{ sku: string; quantity: number }>;
  sku: string | undefined;
  cantidad: number;
  cupo: number;
}): Array<{ variantSku: string; quantity: number }> {
  if (conVariantes) {
    return combinaciones
      .filter((l) => l.quantity > 0)
      .map((l) => ({ variantSku: l.sku, quantity: l.quantity }));
  }
  const q = Math.min(cantidad, cupo);
  return sku && q > 0 ? [{ variantSku: sku, quantity: q }] : [];
}

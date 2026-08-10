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

export function removeFromQuoteCart(index: number): QuoteCartItem[] {
  const items = readRaw();
  items.splice(index, 1);
  writeRaw(items);
  return items;
}

export function clearQuoteCart(): void {
  writeRaw([]);
}

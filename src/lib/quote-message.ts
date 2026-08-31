import { randomInt } from "crypto";

/// Genera el codigo corto de una cotizacion y arma el mensaje de WhatsApp.
/// Solo server-side: el formato, el escape y el armado del link viven en un
/// unico lugar.

/// Charset sin ambiguos: sin O/0/I/1/L, que se confunden dictados por
/// telefono o leidos en una pantalla chica. 31 chars -> 31^6 combinaciones.
const SHORT_CODE_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SHORT_CODE_LENGTH = 6;

/// Codigo corto legible ("A7F3C2"). randomInt y no Math.random: es un
/// identificador publico, pero no cuesta nada que salga del CSPRNG.
export function generateShortCode(): string {
  let code = "";
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    code += SHORT_CODE_CHARSET[randomInt(SHORT_CODE_CHARSET.length)];
  }
  return code;
}

/// WhatsApp interpreta * (negrita) y _ (cursiva). Un nombre de producto que
/// los traiga rompe el formato del mensaje entero, asi que se quitan. No se
/// escapan porque WhatsApp no tiene sintaxis de escape: no existe "\*".
function sanitizeForWhatsapp(text: string): string {
  return text.replace(/[*_~`]/g, "").trim();
}

export interface QuoteMessageLine {
  productName: string;
  variantLabel: string | null;
  printingType: string | null;
  quantity: number;
  /// unitPrice congelado x quantity, ya calculado por quien llama.
  subtotal: number;
}

export interface QuoteMessageInput {
  shortCode: string;
  /// URL completa del detalle. Apunta al PANEL (/admin/cotizaciones/[id]):
  /// el mensaje lo escribe el cliente pero lo recibe el vendedor, y el
  /// destinatario util del link es el vendedor — el cliente acaba de armar
  /// la cotizacion y ya ve el detalle en el propio mensaje.
  detailUrl: string;
  customerName: string;
  companyName: string | null;
  customerEmail: string;
  lines: QuoteMessageLine[];
  /// Suma de (unitPrice congelado x quantity). SIN IVA: se menciona aparte.
  total: number;
  formatPrice: (value: number) => string;
}

/// Tope del TEXTO plano (antes de encodear). Las URLs de wa.me muy largas
/// fallan en algunos clientes; 1500 chars de texto quedan en ~2000-2500
/// encodeados, que es el limite practico.
const MAX_MESSAGE_CHARS = 1500;

/// Arma el texto del mensaje. Si el pedido es largo, trunca la lista de
/// items ("...y N productos mas"); el encabezado, el total y el link no se
/// truncan nunca — el link es el respaldo si el texto no alcanza.
export function buildQuoteMessage(input: QuoteMessageInput): string {
  const quien = [
    sanitizeForWhatsapp(input.customerName),
    input.companyName ? sanitizeForWhatsapp(input.companyName) : null,
  ]
    .filter(Boolean)
    .join(" — ");

  // Los "" del final/principio arman las lineas en blanco que separan
  // encabezado, lista y total (header termina en "\n\n", footer empieza con
  // "\n\n" al concatenar).
  const header = [
    "Hola! Quiero cotizar:",
    "",
    `*Cotización #${input.shortCode}*`,
    quien,
    input.customerEmail,
    "",
    "",
  ].join("\n");

  const footer = [
    "",
    "",
    `Total estimado: ${input.formatPrice(input.total)} + IVA`,
    "",
    `Ver detalle: ${input.detailUrl}`,
  ].join("\n");

  const itemLines = input.lines.map((line) => {
    const detalle = [
      `${line.quantity} u`,
      line.variantLabel ? sanitizeForWhatsapp(line.variantLabel) : null,
      line.printingType ? sanitizeForWhatsapp(line.printingType) : null,
    ]
      .filter(Boolean)
      .join(" — ");
    return `• ${sanitizeForWhatsapp(line.productName)}\n  ${detalle}`;
  });

  // Entran los items que quepan dentro del tope; el resto se resume en una
  // linea "...y N mas". Header/total/link van SIEMPRE. Al presupuestar cada
  // linea se reserva el espacio del aviso de truncado, salvo en la ultima
  // (si es la ultima y entra, no hay nada que avisar).
  const budget = MAX_MESSAGE_CHARS - header.length - footer.length;
  const RESERVA_AVISO = 60;
  const included: string[] = [];
  let used = 0;
  for (const [i, line] of itemLines.entries()) {
    const esLaUltima = i === itemLines.length - 1;
    const reserva = esLaUltima ? 0 : RESERVA_AVISO;
    if (used + line.length + 1 + reserva > budget) {
      const restantes = itemLines.length - i;
      included.push(
        `...y ${restantes} producto${restantes === 1 ? "" : "s"} más — ver detalle en el link`
      );
      break;
    }
    included.push(line);
    used += line.length + 1;
  }

  return header + included.join("\n") + footer;
}

/// Link wa.me completo. encodeURIComponent UNA sola vez sobre el mensaje
/// entero — el doble encoding es el bug clasico aca (%250A en vez de salto
/// de linea).
export function buildWaUrl(phoneDigits: string, message: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
}

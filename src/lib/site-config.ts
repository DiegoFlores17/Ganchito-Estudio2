import type { SiteConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/// La config cuando todavia no hay fila: todo vacio. No hay riesgo de que se
/// desincronice con los defaults del schema porque en esta tabla no hay
/// defaults — los cinco campos son nullable.
const SITE_CONFIG_VACIA: SiteConfig = {
  id: 1,
  contactEmail: null,
  whatsappNumber: null,
  instagramHandle: null,
  address: null,
  openingHours: null,
  updatedAt: new Date(0),
};

/// Datos de contacto de la tienda. Singleton (id = 1).
///
/// **Solo lee: no crea la fila.** El Footer vive en el layout de la tienda,
/// asi que esto corre en el render de TODAS las paginas publicas — y crear
/// una fila desde un render es un efecto secundario donde no corresponde.
///
/// No es teorico: la primera version hacia leer-y-si-no-existe-crear, y el
/// build de produccion se cayo con `P2002 Unique constraint failed`. Al
/// prerenderizar, varias paginas estaticas renderizan el Footer a la vez,
/// las tres ven que la fila no existe, las tres intentan crearla y solo una
/// gana.
///
/// La fila la crea `updateSiteConfig` con un upsert, que es donde se espera
/// escribir.
export async function getSiteConfig(): Promise<SiteConfig> {
  const existing = await prisma.siteConfig.findUnique({ where: { id: 1 } });
  return existing ?? SITE_CONFIG_VACIA;
}

// ---------------------------------------------------------------------------
//  WhatsApp
// ---------------------------------------------------------------------------

/// Deja solo digitos. `wa.me` no acepta "+", espacios ni guiones.
export function normalizeWhatsappNumber(raw: string): string {
  return raw.replace(/\D/g, "");
}

export interface WhatsappValidation {
  ok: boolean;
  /// Los digitos listos para guardar, si `ok`.
  value?: string;
  error?: string;
}

/// Valida un numero para `wa.me`.
///
/// Los tres errores que se cometen con numeros argentinos, y por que rompen
/// el link en silencio (wa.me no falla: abre un chat con un numero que no
/// existe):
///
/// 1. **Sin codigo de pais.** "11 5555-1234" no le dice a WhatsApp que es de
///    Argentina.
/// 2. **Con el 0 de larga distancia.** "011..." — ese 0 es para discado
///    local y sobra en formato internacional.
/// 3. **Con el 15.** "11 15 5555-1234" — el 15 tambien es de discado local.
///    Desde afuera va el 9 despues del 54, no el 15.
export function validateWhatsappNumber(raw: string): WhatsappValidation {
  const digits = normalizeWhatsappNumber(raw);

  if (!digits) return { ok: true, value: undefined };

  // El piso son 11 y no 10 justamente para atajar el error mas comun: un
  // numero argentino local ("11 5555-1234") son 10 digitos y pasaria como
  // valido, generando un link a un numero inexistente sin que nada falle.
  // Con codigo de pais, el mas corto realista tiene 11.
  if (digits.length < 11) {
    return {
      ok: false,
      error:
        "Parece que falta el código de país. Ej: +54 9 11 5555-1234 (no alcanza con 11 5555-1234).",
    };
  }
  if (digits.length > 15) {
    return {
      ok: false,
      error: "El número tiene demasiados dígitos. Revisá que no haya quedado algo pegado.",
    };
  }

  if (digits.startsWith("0")) {
    return {
      ok: false,
      error:
        "Sacá el 0 del principio: en formato internacional va el código de país. Ej: +54 9 11 5555-1234.",
    };
  }

  // Argentina: despues del 54 va un 9 para celulares, y el 15 no va nunca.
  if (digits.startsWith("54")) {
    const resto = digits.slice(2);
    if (resto.startsWith("15")) {
      return {
        ok: false,
        error:
          "Sacá el 15: en formato internacional va un 9 después del 54. Ej: +54 9 11 5555-1234.",
      };
    }
    if (!resto.startsWith("9")) {
      return {
        ok: false,
        error:
          "Para un celular argentino falta el 9 después del 54. Ej: +54 9 11 5555-1234.",
      };
    }
  }

  return { ok: true, value: digits };
}

/// Link de WhatsApp. Null si no hay numero cargado.
export function whatsappUrl(number: string | null): string | null {
  const digits = number ? normalizeWhatsappNumber(number) : "";
  return digits ? `https://wa.me/${digits}` : null;
}

/// Codigos de area argentinos de TRES digitos: las capitales de provincia y
/// las ciudades grandes.
///
/// Existe para poder agrupar bien el numero al mostrarlo. El area argentina
/// tiene 2, 3 o 4 digitos y el abonado ocupa lo que sobra de los 10; sin
/// saber cual es, el corte cae en el lugar equivocado.
///
/// La lista no es exhaustiva —hay decenas de areas de 4 digitos— pero no hace
/// falta que lo sea: lo que no esta aca se trata como area de 4, que es lo
/// correcto para el resto del pais. El unico area de 2 digitos es el 11.
const AREAS_TRES_DIGITOS = new Set([
  // Buenos Aires provincia
  "220", "221", "223", "230", "236", "237", "249", "291",
  // Cuyo
  "260", "261", "263", "264", "266",
  // Patagonia
  "280", "294", "297", "298", "299",
  // Litoral y centro
  "336", "341", "342", "343", "345", "351", "353", "358",
  // Norte
  "362", "364", "370", "376", "379", "380", "381", "383", "385", "387", "388",
]);

/// Version legible del numero, derivada de los digitos guardados.
///
/// Se DERIVA en vez de guardarse aparte: dos campos para el mismo dato se
/// desincronizan el dia que alguien edita uno solo.
///
/// El formato argentino se arma con cuidado (+54 9 11 5555-1234); para
/// cualquier otro pais se cae a "+digitos", que es correcto aunque no sea
/// bonito. Inventar un formateador internacional completo seria arrastrar una
/// libreria entera para un dato que se muestra en un lugar.
export function formatWhatsappLabel(number: string | null): string | null {
  const digits = number ? normalizeWhatsappNumber(number) : "";
  if (!digits) return null;

  if (digits.startsWith("549")) {
    const resto = digits.slice(3); // sin el 54 9

    // En Argentina el numero nacional son SIEMPRE 10 digitos, pero el corte
    // entre area y abonado se mueve: 2 + 8 (Buenos Aires), 3 + 7 (las
    // capitales de provincia) o 4 + 6 (el resto). Sin saber cual es, agrupar
    // sale mal: una version anterior partia el 351 de Cordoba como
    // "+54 9 35 1555-1234".
    if (resto.length === 10) {
      const largoArea = resto.startsWith("11")
        ? 2
        : AREAS_TRES_DIGITOS.has(resto.slice(0, 3))
          ? 3
          : 4;

      const area = resto.slice(0, largoArea);
      const abonado = resto.slice(largoArea);
      const corte = abonado.length - 4;
      return `+54 9 ${area} ${abonado.slice(0, corte)}-${abonado.slice(corte)}`;
    }

    return `+54 9 ${resto}`;
  }

  return `+${digits}`;
}

// ---------------------------------------------------------------------------
//  Instagram
// ---------------------------------------------------------------------------

/// Normaliza lo que sea que peguen al usuario pelado, sin "@".
///
/// Acepta "@ganchitoestudio", "ganchitoestudio",
/// "instagram.com/ganchitoestudio" y la URL completa con https y barra final.
/// La idea es que el admin pegue lo que tenga a mano y funcione.
export function normalizeInstagramHandle(raw: string): string {
  let value = raw.trim();
  if (!value) return "";

  // URL completa o parcial: quedarse con el primer segmento del path.
  const match = value.match(/instagram\.com\/([^/?#\s]+)/i);
  if (match) value = match[1];

  return value.replace(/^@/, "").replace(/\/+$/, "").trim();
}

export function instagramUrl(handle: string | null): string | null {
  const clean = handle ? normalizeInstagramHandle(handle) : "";
  return clean ? `https://instagram.com/${clean}` : null;
}

export function instagramLabel(handle: string | null): string | null {
  const clean = handle ? normalizeInstagramHandle(handle) : "";
  return clean ? `@${clean}` : null;
}

// ---------------------------------------------------------------------------
//  Vista lista para renderizar
// ---------------------------------------------------------------------------

/// Que dato es. Lo usa el footer para elegir el icono, y existe para que esa
/// eleccion NO se haga adivinando por el contenido del string.
export type ContactKind =
  | "email"
  | "whatsapp"
  | "instagram"
  | "address"
  | "hours";

export interface ContactLink {
  kind: ContactKind;
  label: string;
  href: string;
  /// Si abre fuera del sitio (WhatsApp, Instagram).
  external: boolean;
}

export interface ContactText {
  kind: ContactKind;
  value: string;
}

export interface ContactView {
  links: ContactLink[];
  /// Texto sin link (direccion, horarios).
  texts: ContactText[];
  /// Si no hay NADA cargado, el bloque entero no se renderiza.
  isEmpty: boolean;
  /// El destino del boton "Contacto" del hero: WhatsApp si hay, si no el
  /// mail. Null si no hay ninguno de los dos.
  primaryHref: string | null;
}

/// Arma lo que se muestra, salteando lo que no esta cargado.
///
/// Vive aca y no en el Footer para que el hero y el footer no puedan
/// discrepar sobre que dato existe.
export function buildContactView(config: SiteConfig): ContactView {
  const links: ContactLink[] = [];

  if (config.contactEmail) {
    links.push({
      kind: "email",
      label: config.contactEmail,
      href: `mailto:${config.contactEmail}`,
      external: false,
    });
  }

  const wa = whatsappUrl(config.whatsappNumber);
  const waLabel = formatWhatsappLabel(config.whatsappNumber);
  if (wa && waLabel) {
    links.push({ kind: "whatsapp", label: waLabel, href: wa, external: true });
  }

  const ig = instagramUrl(config.instagramHandle);
  const igLabel = instagramLabel(config.instagramHandle);
  if (ig && igLabel) {
    links.push({ kind: "instagram", label: igLabel, href: ig, external: true });
  }

  const texts: ContactText[] = [];
  if (config.address?.trim()) {
    texts.push({ kind: "address", value: config.address });
  }
  if (config.openingHours?.trim()) {
    texts.push({ kind: "hours", value: config.openingHours });
  }

  return {
    links,
    texts,
    isEmpty: links.length === 0 && texts.length === 0,
    primaryHref: wa ?? (config.contactEmail ? `mailto:${config.contactEmail}` : null),
  };
}

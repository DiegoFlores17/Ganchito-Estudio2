import { del } from "@vercel/blob";
import { AdminRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/// Borrado de datos personales a pedido del cliente (Ley 25.326, derecho de
/// supresion). Sin sesion ni cache, para poder probarse desde un script; la
/// accion del panel (cotizaciones/actions.ts) agrega requireSuperAdmin.
///
/// Se ANONIMIZA la cotizacion, no se borra la fila. Borrarla eliminaria en
/// cascada los items y con ellos las metricas (cuantos pedidos, montos,
/// productos cotizados). Lo que se conserva —shortCode, estado, fechas,
/// items, precios— no identifica a nadie.
///
/// Fuera de alcance, a proposito: el aviso que llego por mail. Resend no
/// permite borrar un envio (lo elimina solo a los 30 dias) y la casilla de
/// consultas es de una persona. El panel deja el recordatorio.

/// Valor fijo para `customerEmail`, que es NOT NULL. El dominio `.invalid`
/// esta reservado (RFC 2606): no puede pertenecerle a nadie ni recibir
/// correo. Ojo: todas las anonimizadas comparten este valor, asi que nada
/// debe tratarlas como "el mismo cliente" (ver el historial del detalle).
export const EMAIL_ANONIMIZADO = "datos-borrados@anonimizado.invalid";
export const NOMBRE_ANONIMIZADO = "Datos borrados";

export type BorrarBlob = (url: string) => Promise<void>;

export type ResultadoBorrado =
  | { ok: true; yaEstabaBorrado: boolean }
  | { ok: false; error: string };

/// `del` no tira si el blob ya no existe (documentado por Vercel). Eso es lo
/// que hace seguro el reintento: si una corrida borro el blob y despues fallo
/// la base, la siguiente vuelve a pedirlo y pasa limpio.
async function borrarBlobReal(url: string): Promise<void> {
  await del(url);
}

/// Que hacer con el logo guardado:
/// - `blob`: borrarlo por la direccion del blob, sin query (la URL guardada
///   puede ser la de descarga forzada, `?download=1`, ver saveUploadedFile).
/// - `sin-archivo`: ruta relativa vieja (`/api/uploads/...`, de antes de
///   Blob). Esa ruta y su carpeta se eliminaron al migrar (7f645fa): no queda
///   archivo que borrar.
/// - `desconocido`: absoluta pero de otro host. NO se asume que no hay nada:
///   el archivo podria seguir publico y sin ninguna referencia para
///   encontrarlo. Se frena y no se anonimiza.
type DestinoLogo =
  | { tipo: "blob"; direccion: string }
  | { tipo: "sin-archivo" }
  | { tipo: "desconocido" };

function destinoDelLogo(logoUrl: string): DestinoLogo {
  if (logoUrl.startsWith("/")) return { tipo: "sin-archivo" };
  try {
    const url = new URL(logoUrl);
    if (!url.hostname.endsWith(".public.blob.vercel-storage.com")) {
      return { tipo: "desconocido" };
    }
    return { tipo: "blob", direccion: `${url.origin}${url.pathname}` };
  } catch {
    return { tipo: "desconocido" };
  }
}

function normalizarCodigo(valor: string): string {
  return valor.trim().replace(/^#/, "").toUpperCase();
}

export async function anonimizarCotizacion({
  quoteId,
  confirmacion,
  actorEmail,
  borrarBlob = borrarBlobReal,
}: {
  quoteId: string;
  /// El shortCode tipeado por la persona: la confirmacion explicita.
  confirmacion: string;
  /// Quien lo hace. Se vuelve a validar contra la base aunque la accion ya
  /// haya pedido requireSuperAdmin: es irreversible, y asi el permiso no
  /// depende de que todos los llamadores se acuerden de chequearlo.
  actorEmail: string;
  borrarBlob?: BorrarBlob;
}): Promise<ResultadoBorrado> {
  const actor = await prisma.adminUser.findUnique({
    where: { email: actorEmail },
    select: { email: true, role: true },
  });
  if (!actor || actor.role !== AdminRole.SUPER_ADMIN) {
    return {
      ok: false,
      error: "Solo un super admin puede borrar datos personales.",
    };
  }

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      shortCode: true,
      logoUrl: true,
      personalDataErasedAt: true,
    },
  });
  if (!quote) return { ok: false, error: "La cotización no existe." };

  if (normalizarCodigo(confirmacion) !== quote.shortCode) {
    return {
      ok: false,
      error: `Para confirmar, escribí el código de la cotización (${quote.shortCode}).`,
    };
  }

  // Idempotente: una segunda vez no toca nada ni pisa quien y cuando.
  if (quote.personalDataErasedAt) return { ok: true, yaEstabaBorrado: true };

  // El archivo PRIMERO. Si falla, no se anonimiza nada: la fila conserva el
  // logoUrl y se puede reintentar. Al reves, un fallo dejaria un archivo
  // vivo sin ninguna referencia para encontrarlo.
  if (quote.logoUrl) {
    const destino = destinoDelLogo(quote.logoUrl);
    if (destino.tipo === "desconocido") {
      console.error(
        `[borrado-datos] Cotización ${quote.shortCode}: el logo está en un host que no es Blob; no se modificó nada.`
      );
      return {
        ok: false,
        error:
          "El archivo del cliente está guardado en un lugar que este botón no sabe borrar, así que no se modificó nada. Hay que borrarlo a mano antes.",
      };
    }
    if (destino.tipo === "blob") {
      try {
        await borrarBlob(destino.direccion);
      } catch (error) {
        console.error(
          `[borrado-datos] No se pudo borrar el logo de la cotización ${quote.shortCode}; no se modificó nada:`,
          error
        );
        return {
          ok: false,
          error:
            "No se pudo borrar el archivo del cliente, así que no se modificó nada. Probá de nuevo en unos minutos.",
        };
      }
    } else {
      console.warn(
        `[borrado-datos] Cotización ${quote.shortCode}: el logo no estaba en Blob (dirección vieja), no había archivo que borrar.`
      );
    }
  }

  // Condicionado a que siga sin anonimizar: si dos personas confirman a la
  // vez, la segunda no pisa la fecha ni el autor de la primera.
  const { count } = await prisma.quote.updateMany({
    where: { id: quote.id, personalDataErasedAt: null },
    data: {
      customerName: NOMBRE_ANONIMIZADO,
      customerEmail: EMAIL_ANONIMIZADO,
      customerPhone: null,
      companyName: null,
      notes: null,
      logoUrl: null,
      personalDataErasedAt: new Date(),
      personalDataErasedBy: actor.email,
    },
  });

  // Sin datos personales en el log: solo el codigo y quien.
  if (count > 0) {
    console.log(
      `[borrado-datos] Cotización ${quote.shortCode} anonimizada por ${actor.email}.`
    );
  }
  return { ok: true, yaEstabaBorrado: count === 0 };
}

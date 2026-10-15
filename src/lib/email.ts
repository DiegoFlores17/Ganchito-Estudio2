import { Resend } from "resend";
import { formatDateTime } from "@/lib/format";
import { textoNoVerificado } from "@/lib/sync/textos";

/// Envio de mails transaccionales (Resend). Dos usos hoy: aviso de
/// cotizacion nueva al equipo de Ganchito, y alertas tecnicas del sync.
///
/// REGLA que vale para TODOS los envios de este archivo: un mail que falla
/// NUNCA rompe el flujo que lo disparo. Cuando se manda el aviso, la
/// cotizacion ya esta guardada y el sync ya escribio sus datos — el mail es
/// un extra para que alguien se entere antes, no parte de la transaccion.
/// Por eso `enviar()` captura todo y solo loguea.

/// Dominio propio verificado en Resend. Es un SUBdominio (send.) a
/// proposito: aisla el transaccional del correo humano de Workspace, asi la
/// reputacion de uno no contamina al otro.
const FROM_NEGOCIO = "Ganchito Estudio <cotizaciones@send.ganchitoestudio.com>";
const FROM_ALERTAS = "Ganchito Estudio <alertas@send.ganchitoestudio.com>";

interface EnviarInput {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

/// Resultado de un envio. `id` es el de Resend: es lo que permite cruzar un
/// log de Vercel con el registro del mensaje en el panel de Resend.
export type EnvioResultado =
  | { ok: true; id: string | null }
  | { ok: false; motivo: string };

/// Nunca tira. Loguea SIEMPRE, tambien el exito: sin esa linea, "salio" y
/// "no se intento" se ven igual en los logs (ya costo una vuelta de
/// diagnostico con la primera alerta real del umbral).
async function enviar({
  from,
  to,
  subject,
  html,
  replyTo,
}: EnviarInput): Promise<EnvioResultado> {
  const apiKey = process.env.RESEND_API_KEY;
  const destino = Array.isArray(to) ? to.join(", ") : to;

  // Sin API key NO se manda: se loguea el mail entero. Es lo que hace que
  // en local se pueda verificar el contenido sin quemar cuota ni mandar
  // correos de prueba a nadie. En produccion, si falta la key, este log es
  // el aviso ruidoso de que algo no se configuro.
  if (!apiKey) {
    console.warn(
      `[email] SIN RESEND_API_KEY — no se envia. Habria mandado:\n` +
        `  para: ${destino}\n  asunto: ${subject}\n` +
        (replyTo ? `  responder-a: ${replyTo}\n` : "") +
        `  cuerpo:\n${html}`
    );
    return { ok: false, motivo: "Falta RESEND_API_KEY en el entorno." };
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });
    if (error) {
      console.error(`[email] Resend rechazo el envio a ${destino}:`, error);
      return { ok: false, motivo: `Resend rechazó el envío: ${error.message}` };
    }
    const id = data?.id ?? null;
    console.log(`[email] Enviado a ${destino} (id ${id ?? "?"}): ${subject}`);
    return { ok: true, id };
  } catch (error) {
    console.error(`[email] Fallo el envio a ${destino}:`, error);
    return {
      ok: false,
      motivo: `Falló el envío: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/// Destinatarios de las alertas del sync, desde ALERT_EMAIL. Acepta varios
/// separados por coma o punto y coma: Resend NO entiende una lista dentro de
/// un string ("a@x.com, b@y.com") — pide un array — asi que se parte aca.
/// Lo que no parece un email se descarta (y se informa en `invalidos`), en
/// vez de dejar que Resend rechace el envio entero por una entrada mal tipeada.
export function parseRecipients(raw: string | undefined): {
  validos: string[];
  invalidos: string[];
} {
  const partes = (raw ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const pareceEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  return {
    validos: partes.filter(pareceEmail),
    invalidos: partes.filter((s) => !pareceEmail(s)),
  };
}

/// "diego@gmail.com" -> "d•••@gmail.com". Para mostrar en el panel A QUIEN
/// van las alertas sin exponer la direccion completa.
function enmascarar(email: string): string {
  const [usuario, dominio] = email.split("@");
  return `${usuario.slice(0, 1)}•••@${dominio}`;
}

/// Estado de la configuracion de alertas, para el panel. Lee la variable
/// del lado del servidor (que sea "Sensitive" en Vercel no afecta: oculta
/// el valor en el dashboard, no al runtime).
export function alertConfigStatus(): {
  destinatarios: string[];
  invalidos: number;
  tieneApiKey: boolean;
} {
  const { validos, invalidos } = parseRecipients(process.env.ALERT_EMAIL);
  return {
    destinatarios: validos.map(enmascarar),
    invalidos: invalidos.length,
    tieneApiKey: Boolean(process.env.RESEND_API_KEY),
  };
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/// Base para los links del mail. El dominio propio, nunca el .vercel.app.
function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

const ESTILO_BASE =
  "font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.5;";
const ESTILO_BOTON =
  "display: inline-block; background: #750098; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 999px; font-weight: 500;";

export interface QuoteEmailInput {
  quoteId: string;
  shortCode: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  companyName: string | null;
  notes: string | null;
  logoUrl: string | null;
  lines: Array<{
    productName: string;
    variantLabel: string | null;
    quantity: number;
    unitPriceLabel: string;
    subtotalLabel: string;
  }>;
  totalLabel: string;
  /// A donde se avisa. Sale de SiteConfig.contactEmail (editable desde el
  /// panel): un aviso de cotizacion es negocio, no configuracion tecnica.
  to: string;
}

/// Aviso al equipo de que entro una cotizacion.
///
/// `replyTo` es el email del CLIENTE a proposito: el mail va del sistema al
/// vendedor, y cuando el vendedor lo abre lo natural es querer responderle
/// al cliente. Con esto, "Responder" arranca esa conversacion directo. El
/// cuerpo lo dice explicito para que nadie escriba sin saber adonde va.
export async function sendQuoteNotification(
  input: QuoteEmailInput
): Promise<boolean> {
  const detalleUrl = `${siteUrl()}/admin/cotizaciones/${input.quoteId}`;
  const quien = [input.customerName, input.companyName]
    .filter(Boolean)
    .map((t) => escapar(t!))
    .join(" — ");

  const filas = input.lines
    .map(
      (l) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">
          ${escapar(l.productName)}
          ${l.variantLabel ? `<br><span style="color: #666; font-size: 13px;">${escapar(l.variantLabel)}</span>` : ""}
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: right;">${l.quantity}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: right;">${l.unitPriceLabel}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: right; font-weight: 500;">${l.subtotalLabel}</td>
      </tr>`
    )
    .join("");

  const html = `
<div style="${ESTILO_BASE} max-width: 640px;">
  <p style="color: #666; font-size: 14px; margin: 0 0 4px;">Cotización #${escapar(input.shortCode)}</p>
  <h1 style="font-size: 22px; margin: 0 0 16px;">Entró una cotización nueva</h1>

  <p style="margin: 0 0 4px;"><strong>${quien}</strong></p>
  <p style="margin: 0 0 4px; color: #444;">${escapar(input.customerEmail)}</p>
  ${input.customerPhone ? `<p style="margin: 0 0 4px; color: #444;">${escapar(input.customerPhone)}</p>` : ""}

  <p style="margin: 16px 0; padding: 12px; background: #f5f0f7; border-radius: 8px; font-size: 14px;">
    Respondé este mail para escribirle directamente a ${escapar(input.customerName)}.
  </p>

  <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
    <thead>
      <tr style="text-align: left; color: #666; font-size: 13px;">
        <th style="padding: 8px 12px;">Producto</th>
        <th style="padding: 8px 12px; text-align: right;">Cant.</th>
        <th style="padding: 8px 12px; text-align: right;">Unitario</th>
        <th style="padding: 8px 12px; text-align: right;">Subtotal</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>

  <p style="text-align: right; font-size: 16px; margin: 0 0 20px;">
    Total: <strong>${input.totalLabel}</strong> <span style="color: #666;">+ IVA</span>
  </p>

  ${
    input.notes
      ? `<p style="margin: 0 0 8px; color: #666; font-size: 13px;">Notas del cliente:</p>
         <p style="margin: 0 0 20px; padding: 12px; background: #fafafa; border-radius: 8px; white-space: pre-wrap;">${escapar(input.notes)}</p>`
      : ""
  }

  ${
    input.logoUrl
      ? `<p style="margin: 0 0 20px;">
           <a href="${escapar(input.logoUrl)}" style="color: #750098;">Descargar el logo / arte que subió</a>
         </p>`
      : `<p style="margin: 0 0 20px; color: #666; font-size: 14px;">No subió logo todavía.</p>`
  }

  <a href="${detalleUrl}" style="${ESTILO_BOTON}">Ver en el panel</a>
</div>`.trim();

  const resultado = await enviar({
    from: FROM_NEGOCIO,
    to: input.to,
    // El shortCode en el asunto: es la referencia que el cliente menciona
    // por WhatsApp, asi el mail se encuentra buscando ese codigo.
    subject: `Cotización #${input.shortCode} — ${input.customerName}${input.companyName ? ` (${input.companyName})` : ""}`,
    html,
    replyTo: input.customerEmail,
  });
  return resultado.ok;
}

/// Un producto ausente, como se lo muestra en la alerta del umbral.
export interface AusenteAlerta {
  externalId: string;
  nombre: string | null;
  /// Ultimo stock disponible conocido (de la corrida anterior). Ayuda a
  /// leer la lista: casi todo en 0-10 unidades es perfil de liquidacion.
  stockDisponible: number | null;
}

export type SyncAlertInput =
  /// El auto-pausado se freno por demasiados ausentes de golpe.
  | {
      motivo: "umbral";
      provider: string;
      runId: string;
      ausentes: AusenteAlerta[];
      recordatorio?: boolean;
      umbral: number;
      activos: number;
    }
  /// La corrida termino FAILED (error del loop o guarda de cordura).
  | { motivo: "fallo"; provider: string; runId: string; detalle: string; recordatorio?: boolean }
  /// Productos que el proveedor publica pero no lista: siguen a la venta sin
  /// sincronizarse.
  | {
      motivo: "a-revisar";
      provider: string;
      runId: string;
      productos: AusenteAlerta[];
      /// Ausentes que no se pueden verificar y siguen a la venta (ver
      /// sinVerificarPendientes en lib/sync-run.ts). Opcional: sin ellos el
      /// mail es el de siempre.
      sinVerificar?: Array<AusenteAlerta & { permanente: boolean; motivoVerificacion: string }>;
      recordatorio?: boolean;
    }
  /// Mas de 26 h sin una corrida completa.
  | {
      motivo: "desactualizado";
      provider: string;
      runId: string;
      ultimaCompleta: Date;
      recordatorio?: boolean;
    }
  /// Volvio a estar todo bien despues de un problema avisado.
  | { motivo: "resuelto"; provider: string; runId: string; antes: string }
  /// Demasiadas variantes desactivadas o productos sin variantes de golpe.
  | {
      motivo: "variantes";
      provider: string;
      runId: string;
      desactivadas: number;
      umbralVariantes: number;
      umbralProductos: number;
      productosSinVariantes: AusenteAlerta[];
    }
  /// La corrida llego al tope de productos apagados por quedarse sin foto,
  /// y los siguientes conservaron su estado.
  | {
      motivo: "sin-foto";
      provider: string;
      runId: string;
      /// La corrida anterior ya habia llegado al tope: esta no apago ninguno.
      racha: boolean;
      umbral: number;
      apagados: AusenteAlerta[];
      retenidos: AusenteAlerta[];
    }
  /// Envio de prueba pedido desde el panel.
  | { motivo: "prueba"; provider: string; pedidoPor: string };

/// Nombre visible del proveedor en los mails ("Zecat", no "ZECAT").
function nombreProveedor(provider: string): string {
  if (provider === "ZECAT") return "Zecat";
  if (provider === "CDO") return "CDO Promocionales";
  return provider;
}

/// Alerta tecnica del sync. Va a ALERT_EMAIL (variable de entorno), no a
/// contactEmail: esto lo mira quien mantiene el sistema, no quien vende.
///
/// Es lo que hace posible el cron: con corridas desatendidas, sin este mail
/// un umbral frenado o una corrida fallida no se entera nadie hasta que
/// alguien entra al panel por casualidad.
///
/// El asunto lleva fecha y hora A PROPOSITO: Gmail agrupa en un hilo los
/// mails con el mismo asunto, y asi una alerta nueva quedo escondida debajo
/// de una vieja y no se vio.
export async function sendSyncAlert(
  input: SyncAlertInput
): Promise<EnvioResultado> {
  const { validos, invalidos } = parseRecipients(process.env.ALERT_EMAIL);
  if (invalidos.length) {
    console.warn(
      `[email] ALERT_EMAIL tiene ${invalidos.length} entrada(s) que no parecen un email; se ignoran.`
    );
  }
  if (!validos.length) {
    console.warn(
      "[email] Falta ALERT_EMAIL: la alerta de sync no se envía a nadie."
    );
    return { ok: false, motivo: "ALERT_EMAIL no está configurada." };
  }

  // Armar el texto tambien va protegido: "nunca tira" tiene que ser una
  // garantia de la funcion, no depender de que armarAlerta siga siendo pura.
  let titulo: string;
  let html: string;
  try {
    const alerta = armarAlerta(input);
    titulo = alerta.titulo;
    html = `
<div style="${ESTILO_BASE} max-width: 640px;">
  <h1 style="font-size: 20px; margin: 0 0 12px;">${escapar(titulo)}</h1>
  ${alerta.cuerpo}
  <a href="${alerta.link ?? `${siteUrl()}/admin/proveedores`}" style="${ESTILO_BOTON}">Ver en el panel</a>
</div>`.trim();
  } catch (error) {
    console.error("[email] No se pudo armar la alerta de sync:", error);
    return { ok: false, motivo: "No se pudo armar el texto de la alerta." };
  }

  return enviar({ from: FROM_ALERTAS, to: validos, subject: titulo, html });
}

const ESTILO_PARRAFO = "margin: 0 0 16px;";
const ESTILO_SUBTITULO = "font-size: 15px; margin: 24px 0 8px;";
const ESTILO_NOTA = "margin: 0 0 20px; color: #666; font-size: 13px;";

/// Link directo a una corrida en el historial del panel (cada fila tiene el
/// ancla #corrida-{id}).
function linkCorrida(runId: string): string {
  return `${siteUrl()}/admin/proveedores#corrida-${encodeURIComponent(runId)}`;
}

/// Titulo y cuerpo de cada tipo de alerta. Exportado para verificar el texto
/// sin enviar nada (scripts/audit-verify-email.ts).
export function armarAlerta(
  input: SyncAlertInput,
  ahora: Date = new Date()
): { titulo: string; cuerpo: string; link?: string } {
  const proveedor = nombreProveedor(input.provider);
  const cuando = formatDateTime(ahora);
  // Un recordatorio dice que lo es en el asunto: el problema es el mismo de
  // un mail anterior y sigue sin resolverse.
  const rec = "recordatorio" in input && input.recordatorio ? "Recordatorio — " : "";

  if (input.motivo === "prueba") {
    return {
      titulo: `Alerta de prueba del sync (${cuando})`,
      cuerpo: `
  <p style="${ESTILO_PARRAFO}">Si estás leyendo esto, las alertas de la sincronización de proveedores llegan a esta dirección.</p>
  <p style="${ESTILO_NOTA}">La pidió ${escapar(input.pedidoPor)} desde el panel. No pasó nada con el catálogo.</p>`,
    };
  }

  if (input.motivo === "resuelto") {
    return {
      titulo: `Sync de ${proveedor}: resuelto, el catálogo está al día (${cuando})`,
      link: linkCorrida(input.runId),
      cuerpo: `
  <p style="${ESTILO_PARRAFO}">El problema que avisamos antes (${escapar(input.antes)}) ya no está: la última sincronización completó bien y no queda nada pendiente.</p>
  <p style="${ESTILO_NOTA}">Corrida ${escapar(input.runId)}</p>`,
    };
  }

  if (input.motivo === "desactualizado") {
    return {
      titulo: `${rec}Sync de ${proveedor}: el catálogo no se actualiza hace más de 26 horas (${cuando})`,
      cuerpo: `
  <p style="${ESTILO_PARRAFO}">La última sincronización completa de ${proveedor} fue el ${formatDateTime(input.ultimaCompleta)}. Desde entonces, precios y stock de sus productos pueden estar viejos.</p>
  <h2 style="${ESTILO_SUBTITULO}">Qué hacer</h2>
  <p style="${ESTILO_PARRAFO}">Entrá al panel, en Proveedores, y sincronizá a mano. Si la sincronización automática está activada y esto se repite, avisale a quien opera el sistema: puede que el disparo automático no esté corriendo.</p>`,
    };
  }

  if (input.motivo === "a-revisar") {
    const filas = input.productos
      .map(
        (p) => `
      <tr>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee; color: #666;">${escapar(p.externalId)}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${escapar(p.nombre ?? "(sin nombre)")}</td>
      </tr>`
      )
      .join("");
    const sinVerificar = input.sinVerificar ?? [];
    const filasSinVerificar = sinVerificar
      .map(
        (p) => `
      <tr>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee; color: #666;">${escapar(p.externalId)}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${escapar(p.nombre ?? "(sin nombre)")}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee; text-align: right;">${p.stockDisponible ?? "—"}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee; color: #666;">${escapar(textoNoVerificado(p.permanente, p.motivoVerificacion, proveedor))}</td>
      </tr>`
      )
      .join("");
    const total = input.productos.length + sinVerificar.length;
    return {
      titulo: `${rec}Sync de ${proveedor}: ${total} productos a revisar (${cuando})`,
      link: linkCorrida(input.runId),
      cuerpo: `${
        input.productos.length
          ? `
  <p style="${ESTILO_PARRAFO}">Estos productos no vinieron en el listado de ${proveedor}, pero su ficha sigue publicada y con variantes, así que no se pausaron. Siguen a la venta en la tienda <strong>sin sincronizarse</strong>: su precio y stock no se actualizan.</p>
  <h2 style="${ESTILO_SUBTITULO}">Qué hacer</h2>
  <p style="${ESTILO_PARRAFO}">Buscalos en la web de ${proveedor}. Si no están, avisale a quien opera el sistema para pausarlos. Si vuelven al listado, la próxima sincronización los pone al día sola.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 0 0 20px; font-size: 14px;"><tbody>${filas}</tbody></table>`
          : ""
      }${
        sinVerificar.length
          ? `
  <h2 style="${ESTILO_SUBTITULO}">${sinVerificar.length} que no se pueden verificar</h2>
  <p style="${ESTILO_PARRAFO}">Estos productos no vinieron en el listado de ${proveedor} y no hubo forma de confirmar si los dieron de baja, así que no se pausaron: siguen a la venta <strong>sin sincronizarse</strong>. Al lado de cada uno está por qué.</p>
  <p style="${ESTILO_PARRAFO}">Buscalos en la web de ${proveedor}. Si ya no están, pausalos desde el panel con «Pausar sin confirmación del proveedor».</p>
  <table style="width: 100%; border-collapse: collapse; margin: 0 0 20px; font-size: 14px;">
    <thead>
      <tr style="text-align: left; color: #666; font-size: 13px;">
        <th style="padding: 6px 10px;">Id</th>
        <th style="padding: 6px 10px;">Producto</th>
        <th style="padding: 6px 10px; text-align: right;">Stock</th>
        <th style="padding: 6px 10px;">Por qué</th>
      </tr>
    </thead>
    <tbody>${filasSinVerificar}</tbody>
  </table>`
          : ""
      }
  <p style="${ESTILO_NOTA}">Corrida ${escapar(input.runId)}</p>`,
    };
  }

  if (input.motivo === "fallo") {
    return {
      titulo: `${rec}Sync de ${proveedor}: la corrida falló (${cuando})`,
      cuerpo: `
  <p style="${ESTILO_PARRAFO} white-space: pre-wrap;">${escapar(input.detalle)}</p>
  <p style="${ESTILO_PARRAFO}">Esta corrida no pausó ni borró nada. Los productos que alcanzó a actualizar antes del fallo quedan con los datos nuevos; el resto, con los de la corrida anterior. La próxima sincronización completa los pone al día.</p>
  <p style="${ESTILO_NOTA}">Corrida ${escapar(input.runId)}</p>`,
    };
  }

  if (input.motivo === "sin-foto") {
    const tabla = (lista: AusenteAlerta[]) => `
  <table style="width: 100%; border-collapse: collapse; margin: 0 0 20px; font-size: 14px;">
    <thead>
      <tr style="text-align: left; color: #666; font-size: 13px;">
        <th style="padding: 6px 10px;">Id</th>
        <th style="padding: 6px 10px;">Producto</th>
      </tr>
    </thead>
    <tbody>${lista
      .map(
        (p) => `
      <tr>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee; color: #666;">${escapar(p.externalId)}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${escapar(p.nombre ?? "(sin nombre)")}</td>
      </tr>`
      )
      .join("")}</tbody>
  </table>`;
    const a = input.apagados.length;
    const r = input.retenidos.length;
    if (input.racha) {
      return {
        titulo: `Sync de ${proveedor}: sigue la racha de productos sin foto, ${r} retenidos (${cuando})`,
        cuerpo: `
  <p style="${ESTILO_PARRAFO}"><strong>La racha sigue.</strong> La sincronización anterior ya había llegado al límite de productos sin foto, y en esta las imágenes de <strong>${r} productos</strong> a la venta volvieron a responder que no existen o que no son una imagen: más que el límite de seguridad (${input.umbral}).</p>
  <p style="${ESTILO_PARRAFO}">Mientras dure la racha <strong>no se apaga ningún producto por falta de foto</strong>: los ${r} siguen a la venta con las fotos que tenían. Así una falla larga del servidor de imágenes de ${proveedor} apaga, como mucho, lo que apagó la primera corrida. La racha se corta sola cuando una sincronización termina por debajo del límite.</p>

  <h2 style="${ESTILO_SUBTITULO}">Cómo verificar</h2>
  <p style="${ESTILO_PARRAFO}">Abrí 2 o 3 productos de la lista en la web de ${proveedor}. Si ahí las fotos se ven bien, la falla de su servidor de imágenes sigue. Si tampoco se ven, las sacaron de verdad.</p>

  <h2 style="${ESTILO_SUBTITULO}">Cómo resolver</h2>
  <p style="${ESTILO_PARRAFO}">Si es una falla, no hace falta hacer nada: cuando se arregle, la próxima sincronización vuelve a medir las fotos, prende solos los productos apagados y corta la racha. Si las sacaron de verdad, o si la racha dura varios días, avisale a quien opera el sistema.</p>

  <h2 style="${ESTILO_SUBTITULO}">Los ${r} retenidos (siguen a la venta)</h2>
  ${tabla(input.retenidos)}
  <p style="${ESTILO_NOTA}">Corrida ${escapar(input.runId)}</p>`,
      };
    }
    return {
      titulo: `Sync de ${proveedor}: demasiados productos sin foto, ${r} retenidos (${cuando})`,
      cuerpo: `
  <p style="${ESTILO_PARRAFO}">En esta sincronización, las imágenes de <strong>${a + r} productos</strong> que estaban a la venta respondieron que no existen o que no son una imagen. Es más que el límite de seguridad (${input.umbral}).</p>
  <p style="${ESTILO_PARRAFO}">Se apagaron los primeros <strong>${a}</strong>, hasta llegar al límite. Los otros <strong>${r}</strong> se retuvieron: siguen a la venta con las fotos que tenían, porque tantas fotos rotas de golpe suelen ser una falla del servidor de imágenes de ${proveedor}, no fotos borradas.</p>

  <h2 style="${ESTILO_SUBTITULO}">Cómo verificar</h2>
  <p style="${ESTILO_PARRAFO}">Abrí 2 o 3 productos de la lista en la web de ${proveedor}. Si ahí las fotos se ven bien, fue una falla de su servidor de imágenes. Si tampoco se ven, las sacaron de verdad.</p>

  <h2 style="${ESTILO_SUBTITULO}">Cómo resolver</h2>
  <p style="${ESTILO_PARRAFO}">Si fue una falla, no hace falta hacer nada: la próxima sincronización vuelve a medir las fotos y prende solos los productos apagados. Si las sacaron de verdad, los retenidos se apagan en las próximas corridas, de a lo que permita el límite. Si se repite en varias corridas seguidas, avisale a quien opera el sistema.</p>

  <h2 style="${ESTILO_SUBTITULO}">Los ${r} retenidos (siguen a la venta)</h2>
  ${tabla(input.retenidos)}
  ${a ? `<h2 style="${ESTILO_SUBTITULO}">Los ${a} apagados</h2>${tabla(input.apagados)}` : ""}
  <p style="${ESTILO_NOTA}">Corrida ${escapar(input.runId)}</p>`,
    };
  }

  if (input.motivo === "variantes") {
    const m = input.productosSinVariantes.length;
    const filas = input.productosSinVariantes
      .map(
        (p) => `
      <tr>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee; color: #666;">${escapar(p.externalId)}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${escapar(p.nombre ?? "(sin nombre)")}</td>
      </tr>`
      )
      .join("");
    return {
      titulo: `Sync de ${proveedor}: ${input.desactivadas} variantes desactivadas y ${m} productos sin variantes (${cuando})`,
      cuerpo: `
  <p style="${ESTILO_PARRAFO}">En esta sincronización, ${proveedor} dejó de mandar <strong>${input.desactivadas} variantes</strong> (colores o talles) que estaban a la venta, y <strong>${m} productos</strong> vinieron sin ninguna variante. Es más de lo normal: los límites de seguridad son ${input.umbralVariantes} variantes y ${input.umbralProductos} productos.</p>
  <p style="${ESTILO_PARRAFO}">Ya se aplicó: esas variantes no se muestran ni se pueden cotizar, y los productos sin variantes salieron de la tienda. Las cotizaciones ya enviadas no cambian.</p>

  <h2 style="${ESTILO_SUBTITULO}">Cómo verificar</h2>
  <p style="${ESTILO_PARRAFO}">Buscá 2 o 3 productos de la lista en la web de ${proveedor}. Si ahí tampoco tienen colores o talles disponibles, es real (falta de stock o reposición pendiente) y no hay nada que hacer. Si en la web se ven normales, probablemente fue una falla momentánea de ${proveedor}.</p>

  <h2 style="${ESTILO_SUBTITULO}">Cómo resolver</h2>
  <p style="${ESTILO_PARRAFO}">No hace falta hacer nada para revertirlo: la próxima sincronización que reciba las variantes las vuelve a activar solas. Si fue una falla y no querés esperar, corré una sincronización desde el panel. Si el problema se repite en varias corridas seguidas, avisale a quien opera el sistema.</p>
  ${
    m
      ? `<h2 style="${ESTILO_SUBTITULO}">Los ${m} productos sin variantes</h2>
  <table style="width: 100%; border-collapse: collapse; margin: 0 0 20px; font-size: 14px;">
    <thead>
      <tr style="text-align: left; color: #666; font-size: 13px;">
        <th style="padding: 6px 10px;">Id</th>
        <th style="padding: 6px 10px;">Producto</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>`
      : ""
  }
  <p style="${ESTILO_NOTA}">Corrida ${escapar(input.runId)}</p>`,
    };
  }

  // Umbral. El texto tiene que alcanzar para verificar y resolver sin
  // consultar a nadie: que paso, que significa, como verificar, como
  // resolver. Y la lista COMPLETA — cortarla deja a quien la recibe sin
  // poder revisar justo los que no ve.
  const n = input.ausentes.length;
  const filas = input.ausentes
    .map(
      (a) => `
      <tr>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee; color: #666;">${escapar(a.externalId)}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${escapar(a.nombre ?? "(sin nombre)")}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #eee; text-align: right;">${a.stockDisponible ?? "—"}</td>
      </tr>`
    )
    .join("");

  return {
    titulo: `${rec}Sync de ${proveedor}: ${n} productos dejaron de venir y no se pausó ninguno (${cuando})`,
    link: linkCorrida(input.runId),
    cuerpo: `
  <p style="${ESTILO_PARRAFO}">En esta sincronización, <strong>${n} productos</strong> que están a la venta en la tienda ya no aparecen en el listado de ${proveedor}. El límite de seguridad es ${input.umbral} (sobre ${input.activos} productos activos), así que el sistema <strong>no pausó ninguno</strong>: cuando desaparecen tantos juntos puede ser una baja real o una falla de ${proveedor}, y eso lo decide una persona.</p>
  <p style="${ESTILO_PARRAFO}">Mientras tanto, estos productos siguen visibles en la tienda con el último precio y stock conocidos.</p>

  <h2 style="${ESTILO_SUBTITULO}">Cómo verificar</h2>
  <p style="${ESTILO_PARRAFO}">Buscá 2 o 3 productos de la lista en la web de ${proveedor}, por nombre. Si no aparecen, es una baja real. Si aparecen normalmente, probablemente fue una falla momentánea de ${proveedor}: no hagas nada, la próxima sincronización los vuelve a ver y quedan como estaban.</p>

  <h2 style="${ESTILO_SUBTITULO}">Cómo resolver, si es una baja real</h2>
  <p style="${ESTILO_PARRAFO}">Abrí <a href="${linkCorrida(input.runId)}" style="color: #750098;">esta sincronización en el panel</a> y tocá <strong>«Pausar estos ${n}»</strong>. Antes de pausar, el sistema vuelve a consultar cada producto a ${proveedor}: solo pausa los que ${proveedor} confirma que dio de baja. Los que siguen publicados quedan marcados «a revisar» y no se tocan. Si alguno vuelve a ${proveedor} más adelante, la sincronización lo reactiva sola.</p>

  <h2 style="${ESTILO_SUBTITULO}">Los ${n} productos</h2>
  <table style="width: 100%; border-collapse: collapse; margin: 0 0 20px; font-size: 14px;">
    <thead>
      <tr style="text-align: left; color: #666; font-size: 13px;">
        <th style="padding: 6px 10px;">Id</th>
        <th style="padding: 6px 10px;">Producto</th>
        <th style="padding: 6px 10px; text-align: right;">Último stock</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>
  <p style="${ESTILO_NOTA}">Corrida ${escapar(input.runId)}</p>`,
  };
}

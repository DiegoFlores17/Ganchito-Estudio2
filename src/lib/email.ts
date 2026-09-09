import { Resend } from "resend";

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
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

/// Devuelve true si se envio, false si no se pudo (o si no hay API key).
/// Nunca tira.
async function enviar({
  from,
  to,
  subject,
  html,
  replyTo,
}: EnviarInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  // Sin API key NO se manda: se loguea el mail entero. Es lo que hace que
  // en local se pueda verificar el contenido sin quemar cuota ni mandar
  // correos de prueba a nadie. En produccion, si falta la key, este log es
  // el aviso ruidoso de que algo no se configuro.
  if (!apiKey) {
    console.warn(
      `[email] SIN RESEND_API_KEY — no se envia. Habria mandado:\n` +
        `  para: ${to}\n  asunto: ${subject}\n` +
        (replyTo ? `  responder-a: ${replyTo}\n` : "") +
        `  cuerpo:\n${html}`
    );
    return false;
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });
    if (error) {
      console.error(`[email] Resend rechazo el envio a ${to}:`, error);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[email] Fallo el envio a ${to}:`, error);
    return false;
  }
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

  return enviar({
    from: FROM_NEGOCIO,
    to: input.to,
    // El shortCode en el asunto: es la referencia que el cliente menciona
    // por WhatsApp, asi el mail se encuentra buscando ese codigo.
    subject: `Cotización #${input.shortCode} — ${input.customerName}${input.companyName ? ` (${input.companyName})` : ""}`,
    html,
    replyTo: input.customerEmail,
  });
}

export interface SyncAlertInput {
  provider: string;
  /// "umbral" = el auto-pausado se freno por demasiados ausentes.
  /// "fallo"  = la corrida termino FAILED.
  motivo: "umbral" | "fallo";
  detalle: string;
  runId: string;
}

/// Alerta tecnica del sync. Va a ALERT_EMAIL (variable de entorno), no a
/// contactEmail: esto lo mira quien mantiene el sistema, no quien vende.
///
/// Es lo que hace posible el cron: con corridas desatendidas, sin este mail
/// un umbral frenado o una corrida fallida no se entera nadie hasta que
/// alguien entra al panel por casualidad.
export async function sendSyncAlert(input: SyncAlertInput): Promise<boolean> {
  const to = process.env.ALERT_EMAIL;
  if (!to) {
    console.warn(
      "[email] Falta ALERT_EMAIL: la alerta de sync no se envía a nadie."
    );
    return false;
  }

  const titulo =
    input.motivo === "umbral"
      ? `Sync de ${input.provider}: no se pausó nada por el umbral de seguridad`
      : `Sync de ${input.provider}: la corrida falló`;

  const html = `
<div style="${ESTILO_BASE} max-width: 640px;">
  <h1 style="font-size: 20px; margin: 0 0 12px;">${escapar(titulo)}</h1>
  <p style="margin: 0 0 16px; white-space: pre-wrap;">${escapar(input.detalle)}</p>
  <p style="margin: 0 0 20px; color: #666; font-size: 13px;">Corrida ${escapar(input.runId)}</p>
  <a href="${siteUrl()}/admin/proveedores" style="${ESTILO_BOTON}">Ver en el panel</a>
</div>`.trim();

  return enviar({ from: FROM_ALERTAS, to, subject: titulo, html });
}

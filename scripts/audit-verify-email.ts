// Verificacion de los mails SIN enviarlos. Dos mecanismos:
// - Sin RESEND_API_KEY la lib loguea el mail entero (ver lib/email.ts).
// - Con una key FALSA, fetch esta interceptado: el SDK de Resend cree que
//   habla con la API, pero ningun request sale de esta maquina. Asi se
//   verifican el log de exito, el de rechazo y el array de destinatarios.
//
//   npx tsx scripts/audit-verify-email.ts
import "dotenv/config";
import {
  armarAlerta,
  parseRecipients,
  sendQuoteNotification,
  sendSyncAlert,
} from "../src/lib/email";

// Por las dudas: este script NUNCA debe mandar mails de verdad.
delete process.env.RESEND_API_KEY;
process.env.ALERT_EMAIL = "alertas@ejemplo.test";
process.env.NEXT_PUBLIC_SITE_URL = "https://ganchitoestudio.com";

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

// Fetch interceptado: registra lo que el SDK habria mandado y responde lo
// que diga `respuesta`. Cualquier request que no sea a Resend aborta.
const enviados: Array<{ url: string; body: Record<string, unknown> }> = [];
let respuesta: { status: number; body: unknown } = { status: 200, body: { id: "test-id-123" } };
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://api.resend.com")) {
    throw new Error(`Request inesperado a ${url}: el script no debe salir a la red.`);
  }
  enviados.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
  return new Response(JSON.stringify(respuesta.body), {
    status: respuesta.status,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

// Captura de logs para chequear el texto exacto que se busca en Vercel.
const logs: string[] = [];
for (const nivel of ["log", "warn", "error"] as const) {
  const original = console[nivel].bind(console);
  console[nivel] = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
    original(...args);
  };
}
const huboLog = (fragmento: string) => logs.some((l) => l.includes(fragmento));

const ausentes = Array.from({ length: 54 }, (_, i) => ({
  externalId: String(3700 + i),
  nombre: i === 0 ? 'Mochila "Dual" <test>' : `Producto ${i}`,
  stockDisponible: i,
}));

async function main() {
  console.log("=========== DESTINATARIOS ===========");
  const p1 = parseRecipients(" a@x.com, b@y.com ;c@z.com ");
  check("lista con coma, punto y coma y espacios", p1.validos.join("|") === "a@x.com|b@y.com|c@z.com" && p1.invalidos.length === 0);
  const p2 = parseRecipients("a@x.com, no-es-un-mail, ");
  check("entrada invalida se separa, vacia se ignora", p2.validos.length === 1 && p2.invalidos[0] === "no-es-un-mail");
  check("variable ausente", parseRecipients(undefined).validos.length === 0);
  check("solo espacios", parseRecipients("   ").validos.length === 0);

  console.log("\n=========== TEXTO DEL UMBRAL ===========");
  const fecha = new Date("2026-10-08T17:16:31Z");
  const umbral = armarAlerta({ motivo: "umbral", provider: "ZECAT", runId: "run-1", ausentes, umbral: 31, activos: 636 }, fecha);
  check("asunto con cantidad y fecha en hora ART", umbral.titulo === "Sync de Zecat: 54 productos dejaron de venir y no se pausó ninguno (08/10/2026, 14:16)", umbral.titulo);
  check("lista COMPLETA, sin cortar en 30", ausentes.every((a) => umbral.cuerpo.includes(`>${a.externalId}<`)));
  check("dice como verificar y como resolver", umbral.cuerpo.includes("Cómo verificar") && umbral.cuerpo.includes("Cómo resolver"));
  // "Como resolver" apunta al boton de la corrida, con link directo a ella.
  // Nunca a Productos: ahi los de proveedor no se pueden pausar.
  check("resolver: boton «Pausar estos 54»", umbral.cuerpo.includes("«Pausar estos 54»") && !umbral.cuerpo.includes("desde Productos"));
  check("resolver: link directo a la corrida", umbral.cuerpo.includes('href="https://ganchitoestudio.com/admin/proveedores#corrida-run-1"') && umbral.link === "https://ganchitoestudio.com/admin/proveedores#corrida-run-1");
  check("resolver: aclara que confirma antes de pausar", umbral.cuerpo.includes("vuelve a consultar cada producto"));
  check("nombres escapados", umbral.cuerpo.includes("Mochila &quot;Dual&quot; &lt;test&gt;") && !umbral.cuerpo.includes("<test>"));
  check("umbral y activos en el texto", umbral.cuerpo.includes("límite de seguridad es 31 (sobre 636"));

  const variantes = armarAlerta(
    {
      motivo: "variantes",
      provider: "ZECAT",
      runId: "run-3",
      desactivadas: 120,
      umbralVariantes: 93,
      umbralProductos: 29,
      productosSinVariantes: [{ externalId: "5699", nombre: "Neceser <Weg>", stockDisponible: null }],
    },
    fecha
  );
  check("asunto de variantes con conteos y fecha", variantes.titulo === "Sync de Zecat: 120 variantes desactivadas y 1 productos sin variantes (08/10/2026, 14:16)", variantes.titulo);
  check("variantes: dice que se revierte solo y escapa nombres", variantes.cuerpo.includes("las vuelve a activar solas") && variantes.cuerpo.includes("Neceser &lt;Weg&gt;"));

  const fallo = armarAlerta({ motivo: "fallo", provider: "ZECAT", runId: "run-2", detalle: "Zecat respondió 503" }, fecha);
  check("asunto del fallo con fecha", fallo.titulo === "Sync de Zecat: la corrida falló (08/10/2026, 14:16)", fallo.titulo);
  const prueba = armarAlerta({ motivo: "prueba", provider: "ZECAT", pedidoPor: "admin@ejemplo.test" }, fecha);
  check("asunto de la prueba con fecha", prueba.titulo === "Alerta de prueba del sync (08/10/2026, 14:16)", prueba.titulo);

  console.log("\n=========== SIN API KEY (loguea el mail entero) ===========");
  const r1 = await sendSyncAlert({ motivo: "umbral", provider: "ZECAT", runId: "run-1", ausentes, umbral: 31, activos: 636 });
  check("devuelve ok:false con motivo", !r1.ok && r1.motivo.includes("RESEND_API_KEY"));
  check("log 'SIN RESEND_API_KEY'", huboLog("[email] SIN RESEND_API_KEY — no se envia."));
  check("no salio ningun request", enviados.length === 0);

  console.log("\n=========== SIN ALERT_EMAIL ===========");
  delete process.env.ALERT_EMAIL;
  const r2 = await sendSyncAlert({ motivo: "fallo", provider: "ZECAT", detalle: "x", runId: "r" });
  check("devuelve ok:false", !r2.ok && r2.motivo.includes("ALERT_EMAIL"));
  check("log 'Falta ALERT_EMAIL'", huboLog("[email] Falta ALERT_EMAIL: la alerta de sync no se envía a nadie."));

  console.log("\n=========== ENVIO EXITOSO (fetch interceptado) ===========");
  process.env.RESEND_API_KEY = "re_FALSA_solo_para_este_script";
  process.env.ALERT_EMAIL = "uno@ejemplo.test, dos@ejemplo.test";
  respuesta = { status: 200, body: { id: "test-id-123" } };
  const r3 = await sendSyncAlert({ motivo: "prueba", provider: "ZECAT", pedidoPor: "admin@ejemplo.test" });
  check("devuelve ok:true con el id de Resend", r3.ok && r3.id === "test-id-123");
  const cuerpo = enviados.at(-1)?.body;
  check("'to' viaja como ARRAY de dos destinatarios", Array.isArray(cuerpo?.to) && (cuerpo?.to as string[]).length === 2, JSON.stringify(cuerpo?.to));
  check("log de exito con id", huboLog("[email] Enviado a uno@ejemplo.test, dos@ejemplo.test (id test-id-123): Alerta de prueba del sync"));

  console.log("\n=========== RECHAZO DE RESEND (fetch interceptado) ===========");
  respuesta = { status: 403, body: { statusCode: 403, name: "validation_error", message: "The send.ganchitoestudio.com domain is not verified." } };
  const r4 = await sendSyncAlert({ motivo: "fallo", provider: "ZECAT", detalle: "x", runId: "r" });
  check("devuelve ok:false con el mensaje de Resend", !r4.ok && r4.motivo.includes("not verified"), !r4.ok ? r4.motivo : "");
  check("log 'Resend rechazo el envio'", huboLog("[email] Resend rechazo el envio a uno@ejemplo.test, dos@ejemplo.test"));

  console.log("\n=========== COTIZACION (sigue devolviendo boolean) ===========");
  respuesta = { status: 200, body: { id: "test-id-456" } };
  const ok5 = await sendQuoteNotification({
    quoteId: "cmt-demo-123",
    shortCode: "A7F3C2",
    customerName: "Juan Pérez",
    customerEmail: "juan@empresa.com",
    customerPhone: "+54 9 351 555-1234",
    companyName: "Empresa <S.A.>",
    notes: "Necesitamos el logo en dorado.",
    logoUrl: null,
    lines: [{ productName: "Taza", variantLabel: null, quantity: 20, unitPriceLabel: "$ 2.374", subtotalLabel: "$ 47.480" }],
    totalLabel: "$ 47.480",
    to: "consultas@ganchitoestudio.com",
  });
  check("cotizacion devuelve true y conserva replyTo", ok5 === true && enviados.at(-1)?.body.reply_to === "juan@empresa.com", JSON.stringify(enviados.at(-1)?.body.reply_to));
}

main()
  .catch((e) => {
    fallos++;
    console.error("TIRO (no deberia):", e);
  })
  .finally(() => {
    console.log(fallos ? `\n${fallos} chequeo(s) fallaron.` : "\nTodos los chequeos pasan. Ningun mail salio de esta maquina.");
    if (fallos) process.exitCode = 1;
  });

// Verificacion de los mails SIN enviarlos: sin RESEND_API_KEY la lib loguea
// el mail entero (ver lib/email.ts). Chequea contenido y que nunca tire.
import "dotenv/config";
import { sendQuoteNotification, sendSyncAlert } from "../src/lib/email";

// Por las dudas: este script NUNCA debe mandar mails de verdad.
delete process.env.RESEND_API_KEY;
process.env.ALERT_EMAIL = "alertas@ejemplo.test";
process.env.NEXT_PUBLIC_SITE_URL = "https://ganchitoestudio.com";

async function main() {
  console.log("=========== MAIL DE COTIZACION ===========");
  const ok1 = await sendQuoteNotification({
    quoteId: "cmt-demo-123",
    shortCode: "A7F3C2",
    customerName: "Juan Pérez",
    customerEmail: "juan@empresa.com",
    customerPhone: "+54 9 351 555-1234",
    companyName: "Empresa <S.A.>",
    notes: "Necesitamos el logo en dorado.\nUrgente para el 20.",
    logoUrl: "https://ejemplo.public.blob.vercel-storage.com/quotes/abc.pdf",
    lines: [
      { productName: 'Mochila "OSTEN"', variantLabel: "Negro", quantity: 50, unitPriceLabel: "$ 85.486", subtotalLabel: "$ 4.274.300" },
      { productName: "Taza & Co <test>", variantLabel: null, quantity: 20, unitPriceLabel: "$ 2.374", subtotalLabel: "$ 47.480" },
    ],
    totalLabel: "$ 4.321.780",
    to: "consultas@ganchitoestudio.com",
  });
  console.log("\n>> devolvio:", ok1, "(false esperado: no hay API key)\n");

  console.log("=========== ALERTA: UMBRAL ===========");
  await sendSyncAlert({
    provider: "ZECAT",
    motivo: "umbral",
    detalle: "47 productos activos dejaron de venir en la API de golpe, y el umbral de seguridad es 32. NO se pausó ninguno.",
    runId: "run-demo-1",
  });

  console.log("\n=========== ALERTA: FALLO ===========");
  await sendSyncAlert({
    provider: "CDO",
    motivo: "fallo",
    detalle: "Respuesta anómala del proveedor: devolvió 3 productos contra 309 activos nuestros.",
    runId: "run-demo-2",
  });

  console.log("\n=========== SIN ALERT_EMAIL ===========");
  delete process.env.ALERT_EMAIL;
  const ok4 = await sendSyncAlert({ provider: "ZECAT", motivo: "fallo", detalle: "x", runId: "r" });
  console.log(">> devolvio:", ok4, "(false esperado, y no tiro)");
}
main().then(() => console.log("\nNINGUNA llamada tiro — el flujo nunca se rompe."));

// Verificacion del deep link de WhatsApp: submitQuote devuelve waUrl con el
// mensaje bien armado, la Quote queda guardada ANTES, y el mensaje respeta
// encoding unico, escape de * / _, y truncado.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { submitQuote } from "../src/app/(store)/cotizar/actions";
import { buildQuoteMessage } from "../src/lib/quote-message";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("localhost")) throw new Error("ABORTADO: no es la base local.");

  // Asegurar numero de WhatsApp en la config (restaurando al final).
  const cfg = await prisma.siteConfig.findUnique({ where: { id: 1 } });
  const numeroOriginal = cfg?.whatsappNumber ?? null;
  await prisma.siteConfig.upsert({
    where: { id: 1 },
    update: { whatsappNumber: "5493516871724" },
    create: { id: 1, whatsappNumber: "5493516871724" },
  });

  const producto = await prisma.product.findFirst({
    where: { active: true, deletedAt: null, variants: { some: {} } },
    include: { variants: { take: 1 } },
  });
  if (!producto) throw new Error("sin producto");

  try {
    const fd = new FormData();
    fd.set("customerName", "Test *Negrita* _Cursiva_");
    fd.set("customerEmail", "wa@test.local");
    fd.set("companyName", "Empresa SA");
    fd.set("items", JSON.stringify([
      { productId: producto.id, variantSku: producto.variants[0].sku, quantity: 3 },
    ]));
    const r = await submitQuote(fd);

    console.log("[submit] success:", r.success, "| shortCode:", r.shortCode);
    console.log("[submit] token largo 32:", r.publicToken?.length === 32);
    console.log("[submit] shortCode valido:", /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(r.shortCode ?? ""));

    // La Quote existe en la base (guardada ANTES de armar el link).
    const q = await prisma.quote.findUnique({ where: { id: r.quoteId! }, include: { items: true } });
    console.log("[db] guardada con items:", q?.items.length, "| unitPrice congelado:", q?.items[0]?.unitPrice?.toString());

    // El mensaje decodificado: UNA pasada de decodeURIComponent lo deja
    // legible (si hubiera doble encoding apareceria %250A).
    const texto = decodeURIComponent(r.waUrl!.split("?text=")[1]);
    console.log("[wa] host ok:", r.waUrl!.startsWith("https://wa.me/5493516871724?text="));
    console.log("[wa] sin doble encoding:", !texto.includes("%0A") && texto.includes("\n"));
    console.log("[wa] escape de estrellas: nombre sin * :", !texto.includes("*Negrita*"));
    console.log("[wa] shortCode presente:", texto.includes(`#${r.shortCode}`));
    console.log("[wa] link al detalle:", texto.includes(`/cotizacion/${r.publicToken}`));
    // formatPriceArs separa el $ con un NBSP ( ) de Intl.NumberFormat,
    // no con un espacio comun — \s matchea los dos.
    console.log("[wa] total + IVA:", /Total estimado: \$\s?[\d.,]+ \+ IVA/.test(texto));
    console.log("--- mensaje ---\n" + texto + "\n---------------");

    // Truncado: 40 lineas largas tienen que resumirse y el link sobrevivir.
    const largo = buildQuoteMessage({
      shortCode: "TEST99",
      publicToken: "x".repeat(32),
      customerName: "Cliente",
      companyName: null,
      customerEmail: "a@b.co",
      lines: Array.from({ length: 40 }, (_, i) => ({
        productName: `Producto con nombre bastante largo numero ${i + 1}`,
        variantLabel: "Azul / XL",
        printingType: null,
        quantity: 10,
        subtotal: 1000,
      })),
      total: 40000,
      formatPrice: (v) => `$${v}`,
      siteUrl: "https://ganchitoestudio.com",
    });
    console.log("[trunc] largo total:", largo.length, "<= 1500:", largo.length <= 1500);
    console.log("[trunc] tiene resumen:", /\.\.\.y \d+ productos? más/.test(largo));
    console.log("[trunc] link sobrevive:", largo.includes("/cotizacion/"));

    // Limpieza.
    await prisma.quote.delete({ where: { id: r.quoteId! } });
    console.log("[db] cotizacion de prueba borrada");
  } finally {
    await prisma.siteConfig.update({ where: { id: 1 }, data: { whatsappNumber: numeroOriginal } });
    console.log("[restore] whatsappNumber restaurado");
  }
}

main().finally(() => prisma.$disconnect());

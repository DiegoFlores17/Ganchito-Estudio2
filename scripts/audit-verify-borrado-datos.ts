// Verificacion del borrado de datos personales (src/lib/borrado-datos.ts)
// contra la base LOCAL. Crea sus propias cotizaciones y un admin de prueba, y
// los borra al terminar.
//
// El borrado de Blob se INYECTA: un doble registra que URL se pidio borrar o
// falla a pedido. Asi se prueba la logica (orden, reintento, que no se toque
// nada si falla) sin escribir en el store real — el token del .env puede ser
// el de produccion. Que `del` en si funcione es responsabilidad del SDK.
//
// Uso: npx tsx scripts/audit-verify-borrado-datos.ts
import "dotenv/config";
import { AdminRole, QuoteStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  anonimizarCotizacion,
  EMAIL_ANONIMIZADO,
  NOMBRE_ANONIMIZADO,
} from "../src/lib/borrado-datos";

let fallas = 0;
function check(nombre: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallas++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle !== undefined ? ` — ${JSON.stringify(detalle)}` : ""}`);
}

const ADMIN_PRUEBA = "admin-prueba-borrado@test.local";
const LOGO_BLOB =
  "https://prueba.public.blob.vercel-storage.com/quotes/00000000-0000-0000-0000-000000000000.svg?download=1";

async function main() {
  // Por el HOST, no por un includes: "localhost" en un query string de una
  // URL remota no tiene que pasar.
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`ABORTADO: DATABASE_URL apunta a "${host}", no a la base local.`);
  }

  const superAdmin = await prisma.adminUser.findFirst({
    where: { role: AdminRole.SUPER_ADMIN },
  });
  if (!superAdmin) throw new Error("no hay super admin en la base local");
  const producto = await prisma.product.findFirst({
    where: { active: true, deletedAt: null, variants: { some: { active: true } } },
    include: { variants: { where: { active: true }, take: 1 } },
  });
  if (!producto) throw new Error("no hay producto con variantes");

  const crear = (logoUrl: string | null) =>
    prisma.quote.create({
      data: {
        status: QuoteStatus.QUOTED,
        shortCode: `T${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        customerName: "Cliente Prueba Borrado",
        customerEmail: "cliente-borrado@test.local",
        customerPhone: "351 235-0995",
        companyName: "Empresa Prueba",
        notes: "Notas con datos personales",
        logoUrl,
        privacyAcceptedAt: new Date(),
        privacyVersion: "2026-10-28",
        items: {
          create: [
            { productId: producto.id, variantSku: producto.variants[0].sku, quantity: 7, unitPrice: "1234.56" },
            { productId: producto.id, variantSku: producto.variants[0].sku, quantity: 3, unitPrice: "100.00" },
          ],
        },
      },
      include: { items: true },
    });

  await prisma.adminUser.create({
    data: { email: ADMIN_PRUEBA, role: AdminRole.ADMIN },
  });
  const q = await crear(LOGO_BLOB);
  const legacy = await crear("/api/uploads/quotes/00000000-0000-0000-0000-000000000000.png");
  const otroHost = await crear("https://cdn.otro-lugar.example/quotes/logo.png");

  const borrados: string[] = [];
  const blobOk = async (u: string) => {
    borrados.push(u);
  };
  const blobFalla = async () => {
    throw new Error("Blob caido (simulado)");
  };
  const intacta = async (id: string) => {
    const x = await prisma.quote.findUniqueOrThrow({ where: { id } });
    return (
      x.customerName === "Cliente Prueba Borrado" &&
      x.customerEmail === "cliente-borrado@test.local" &&
      x.logoUrl !== null &&
      x.personalDataErasedAt === null
    );
  };

  try {
    // 1) Un ADMIN que no es super: rechazado, sin tocar nada.
    const r1 = await anonimizarCotizacion({ quoteId: q.id, confirmacion: q.shortCode, actorEmail: ADMIN_PRUEBA, borrarBlob: blobOk });
    check("ADMIN comun rechazado", !r1.ok, r1);
    check("ADMIN comun: no se pidio borrar el blob", borrados.length === 0);
    check("ADMIN comun: la cotizacion sigue intacta", await intacta(q.id));

    // 2) Un email que ni siquiera es admin: rechazado.
    const r2 = await anonimizarCotizacion({ quoteId: q.id, confirmacion: q.shortCode, actorEmail: "nadie@test.local", borrarBlob: blobOk });
    check("no-admin rechazado", !r2.ok);

    // 3) Confirmacion equivocada: rechazado.
    const r3 = await anonimizarCotizacion({ quoteId: q.id, confirmacion: "ZZZZZZ", actorEmail: superAdmin.email, borrarBlob: blobOk });
    check("codigo de confirmacion equivocado rechazado", !r3.ok, r3);
    check("codigo equivocado: intacta y sin borrar blob", (await intacta(q.id)) && borrados.length === 0);

    // 4) El blob no se puede borrar: falla limpio, no se anonimiza nada.
    const r4 = await anonimizarCotizacion({ quoteId: q.id, confirmacion: q.shortCode, actorEmail: superAdmin.email, borrarBlob: blobFalla });
    check("blob que falla -> ok:false con mensaje", !r4.ok && /no se modificó nada/.test(r4.error), r4);
    check("blob que falla -> la cotizacion sigue intacta (logoUrl incluido, se puede reintentar)", await intacta(q.id));

    // 5) Reintento exitoso (con "#" y minusculas en la confirmacion).
    const r5 = await anonimizarCotizacion({ quoteId: q.id, confirmacion: `#${q.shortCode.toLowerCase()}`, actorEmail: superAdmin.email, borrarBlob: blobOk });
    check("super admin -> ok, primera vez", r5.ok && !r5.yaEstabaBorrado, r5);
    check("se pidio borrar el blob UNA vez, por su direccion sin ?download=1", borrados.length === 1 && borrados[0] === LOGO_BLOB.split("?")[0], borrados);

    const a = await prisma.quote.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
    check("nombre anonimizado", a.customerName === NOMBRE_ANONIMIZADO);
    check("email reemplazado por el valor fijo", a.customerEmail === EMAIL_ANONIMIZADO);
    check("telefono, empresa, notas y logo en null", a.customerPhone === null && a.companyName === null && a.notes === null && a.logoUrl === null);
    check("registra quien", a.personalDataErasedBy === superAdmin.email, a.personalDataErasedBy);
    const seg = a.personalDataErasedAt ? (Date.now() - a.personalDataErasedAt.getTime()) / 1000 : null;
    check("registra cuando (hace < 60 s)", seg !== null && seg >= 0 && seg < 60, seg);
    check("conserva shortCode, estado y fecha de creacion", a.shortCode === q.shortCode && a.status === q.status && a.createdAt.getTime() === q.createdAt.getTime());
    check("conserva la aceptacion de la politica", a.privacyVersion === "2026-10-28" && a.privacyAcceptedAt !== null);
    const total = (items: { quantity: number; unitPrice: { toString(): string } }[]) =>
      items.reduce((s, i) => s + Number(i.unitPrice.toString()) * i.quantity, 0);
    check("conserva los items (cantidad, sku, precio)", a.items.length === 2 &&
      JSON.stringify(a.items.map((i) => [i.variantSku, i.quantity, i.unitPrice.toString()]).sort()) ===
      JSON.stringify(q.items.map((i) => [i.variantSku, i.quantity, i.unitPrice.toString()]).sort()));
    check("conserva el total (metricas)", total(a.items) === total(q.items), total(a.items));

    // 6) Idempotente: una segunda vez no rompe, no vuelve a pedir el blob y
    //    no pisa quien ni cuando.
    const r6 = await anonimizarCotizacion({ quoteId: q.id, confirmacion: q.shortCode, actorEmail: superAdmin.email, borrarBlob: blobFalla });
    check("segunda vez -> ok, yaEstabaBorrado (aunque Blob este caido)", r6.ok && r6.yaEstabaBorrado, r6);
    const b = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    check("segunda vez: no pisa la fecha ni el autor", b.personalDataErasedAt?.getTime() === a.personalDataErasedAt?.getTime() && b.personalDataErasedBy === a.personalDataErasedBy);
    check("segunda vez: no se volvio a pedir el blob", borrados.length === 1);

    // 7) Logo viejo (/api/uploads, de antes de Blob): se anonimiza sin pedir
    //    borrar nada afuera.
    //    El doble que registra: si se lo llamara, `borrados` crece.
    const r7 = await anonimizarCotizacion({ quoteId: legacy.id, confirmacion: legacy.shortCode, actorEmail: superAdmin.email, borrarBlob: blobOk });
    const l = await prisma.quote.findUniqueOrThrow({ where: { id: legacy.id } });
    check("logo viejo relativo -> anonimiza", r7.ok && l.logoUrl === null && l.personalDataErasedAt !== null, r7);
    check("logo viejo relativo -> no se llamo a Blob", borrados.length === 1, borrados);

    // 7b) Logo absoluto en un host que no es Blob: NO se asume que no hay
    //     archivo. Se frena sin tocar nada.
    const r7b = await anonimizarCotizacion({ quoteId: otroHost.id, confirmacion: otroHost.shortCode, actorEmail: superAdmin.email, borrarBlob: blobOk });
    check("logo en host desconocido -> ok:false", !r7b.ok, r7b);
    check("logo en host desconocido -> intacta y sin llamar a Blob", (await intacta(otroHost.id)) && borrados.length === 1);

    // 8) Cotizacion inexistente.
    const r8 = await anonimizarCotizacion({ quoteId: "no-existe", confirmacion: "X", actorEmail: superAdmin.email, borrarBlob: blobOk });
    check("cotizacion inexistente -> ok:false", !r8.ok);
  } finally {
    await prisma.quote.deleteMany({ where: { id: { in: [q.id, legacy.id, otroHost.id] } } });
    await prisma.adminUser.delete({ where: { email: ADMIN_PRUEBA } });
    console.log("[limpieza] cotizaciones y admin de prueba borrados");
  }

  console.log(fallas === 0 ? "\nTODO OK" : `\n${fallas} FALLA(S)`);
  if (fallas > 0) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());

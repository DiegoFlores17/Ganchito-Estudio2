import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatPriceArs } from "@/lib/format";

// Publica pero NO indexable: la URL es un secreto compartido (el token), y
// un buscador que la indexe la dejaria de serlo.
export const metadata: Metadata = {
  title: "Detalle de cotización",
  robots: { index: false, follow: false },
};

/// Detalle de una cotizacion por su token publico. Es el link que viaja en
/// el mensaje de WhatsApp: sin auth, pero solo lo tiene quien recibio el
/// mensaje (o quien cotizo).
///
/// select EXPLICITO a proposito: aca no puede entrar costPrice, margen, ni
/// nada interno. Los precios que se muestran son los CONGELADOS de la
/// cotizacion — no se recalcula nada, por diseño.
async function getQuoteByPublicToken(token: string) {
  return prisma.quote.findUnique({
    where: { publicToken: token },
    select: {
      shortCode: true,
      createdAt: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      companyName: true,
      items: {
        select: {
          id: true,
          variantSku: true,
          quantity: true,
          printingType: true,
          unitPrice: true,
          product: {
            select: {
              name: true,
              // Para traducir el sku congelado a "Azul / M" cuando la
              // variante todavia existe. Si ya no existe, se muestra el sku
              // tal cual: es lo que se cotizo.
              variants: { select: { sku: true, colorName: true, sizeName: true } },
            },
          },
        },
      },
    },
  });
}

export default async function CotizacionPublicaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const quote = await getQuoteByPublicToken(token);
  if (!quote) notFound();

  const lineas = quote.items.map((item) => {
    const variant = item.variantSku
      ? item.product.variants.find((v) => v.sku === item.variantSku)
      : null;
    const variantLabel = variant
      ? [variant.colorName, variant.sizeName].filter(Boolean).join(" / ") ||
        null
      : item.variantSku;
    const unitPrice = Number(item.unitPrice);
    return {
      id: item.id,
      productName: item.product.name,
      variantLabel,
      printingType: item.printingType,
      quantity: item.quantity,
      unitPriceLabel: formatPriceArs(unitPrice),
      subtotal: unitPrice * item.quantity,
    };
  });

  const total = lineas.reduce((sum, l) => sum + l.subtotal, 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm text-foreground/50">
        Cotización{" "}
        <strong className="text-foreground">#{quote.shortCode}</strong> ·{" "}
        {quote.createdAt.toLocaleDateString("es-AR")}
      </p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-foreground">
        Tu solicitud de cotización
      </h1>
      <p className="mt-2 text-foreground/70">
        Estos son los precios estimados al momento del pedido. Te enviamos el
        presupuesto final con el boceto de personalización.
      </p>

      <div className="mt-8 overflow-x-auto rounded-xl border border-foreground/10 bg-background">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-xs text-foreground/50">
              <th className="px-4 py-3 font-medium">Producto</th>
              <th className="px-4 py-3 font-medium">Variante</th>
              <th className="px-4 py-3 font-medium">Cant.</th>
              <th className="px-4 py-3 font-medium">Precio unit.</th>
              <th className="px-4 py-3 font-medium">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((linea) => (
              <tr key={linea.id} className="border-b border-foreground/5">
                <td className="px-4 py-3 font-medium text-foreground">
                  {linea.productName}
                  {linea.printingType && (
                    <span className="block text-xs text-foreground/50">
                      {linea.printingType}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-foreground/70">
                  {linea.variantLabel ?? "—"}
                </td>
                <td className="px-4 py-3 text-foreground/70">
                  {linea.quantity}
                </td>
                <td className="px-4 py-3 text-foreground/70">
                  {linea.unitPriceLabel}
                </td>
                <td className="px-4 py-3 font-medium text-foreground">
                  {formatPriceArs(linea.subtotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-right text-lg">
        Total estimado:{" "}
        <strong className="text-foreground">{formatPriceArs(total)}</strong>{" "}
        <span className="text-foreground/50">+ IVA</span>
      </p>

      <div className="mt-8 rounded-xl border border-foreground/10 bg-background p-5 text-sm">
        <p className="font-medium text-foreground">Datos de contacto</p>
        <p className="mt-2 text-foreground/70">
          {quote.customerName}
          {quote.companyName && <> · {quote.companyName}</>}
        </p>
        <p className="text-foreground/70">{quote.customerEmail}</p>
        {quote.customerPhone && (
          <p className="text-foreground/70">{quote.customerPhone}</p>
        )}
      </div>

      <Link
        href="/catalogo"
        className="mt-8 inline-block text-sm font-medium text-foreground/60 transition-colors hover:text-primary"
      >
        ← Volver al catálogo
      </Link>
    </div>
  );
}

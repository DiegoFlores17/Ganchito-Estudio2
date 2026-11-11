import Link from "next/link";
import { notFound } from "next/navigation";
import {
  aCentavos,
  formatDate,
  formatDateTime,
  formatPriceArsCentavos,
} from "@/lib/format";
import { requireAdmin } from "@/lib/admin-auth";
import {
  getEstadoVivoDeVariantes,
  getNombresDeProductos,
  getQuoteById,
  getQuoteHistoryByEmail,
} from "@/lib/admin-quotes";
import { AdminRole } from "@prisma/client";
import {
  productosConRecargo,
  textoRecargoProveedor,
  textoUmbral,
} from "@/lib/quote-minimum";
import {
  esCotizacionCerrada,
  lineasSobreElStock,
  textoPedidoMayorAlStock,
} from "@/lib/quote-stock";
import { TEXTO_SELECCION_DESCARTADA } from "@/lib/quote-printing";
import { LEYENDAS_PRECIO } from "@/lib/leyendas-precio";
import { QuoteEraseButton } from "@/components/admin/quote-erase-button";
import { QuoteStatusSelect } from "@/components/admin/quote-status-select";
import { StatusBadge } from "@/components/admin/status-badge";

export default async function CotizacionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // La autorizacion no puede quedar solo en el layout: ver el comentario de
  // requireAdmin() en src/lib/admin-auth.ts.
  //
  // Esta pantalla se habia salteado en el fix de 1278e4c, que agrego el gate
  // propio al resto del panel. Hoy no era un agujero —el gate del layout es
  // bloqueante y no esta detras de Suspense— pero es la pantalla con MAS dato
  // personal del panel (nombre, mail y telefono del cliente, mas su historial
  // de cotizaciones), asi que es la ultima que conviene dejar dependiendo de
  // una sola barrera.
  const admin = await requireAdmin();

  const { id } = await params;
  const quote = await getQuoteById(id);
  if (!quote) notFound();

  // Anonimizada: todas comparten el mismo email fijo (EMAIL_ANONIMIZADO), asi
  // que el "historial del cliente" las mezclaria entre si como si fueran de
  // una misma persona. Sin datos, no hay cliente que agrupar.
  const borrada = quote.personalDataErasedAt !== null;
  const history = borrada
    ? []
    : await getQuoteHistoryByEmail(quote.customerEmail, quote.id);
  // Productos con recargo de personalizacion del proveedor (total del producto
  // debajo del umbral, con el snapshot de cada linea). Solo se ve aca y en
  // el mail: el cliente no ve este umbral en ninguna parte.
  const conRecargo = productosConRecargo(quote.items);
  // Pedido mayor al stock, EN VIVO contra el stock de hoy (no se congela: si
  // el sync repone, la marca desaparece). Una variante inactiva o que ya no
  // existe no se marca: se avisa con una nota neutra. En una cotizacion
  // cerrada (aceptada, rechazada o vencida) no se muestra nada de esto: el
  // stock de hoy no dice nada sobre algo que ya se resolvio.
  const cerrada = esCotizacionCerrada(quote.status);
  const estadoVivo = cerrada
    ? new Map<string, { disponible: number; active: boolean }>()
    : await getEstadoVivoDeVariantes(
        quote.items.flatMap((i) => (i.variantSku ? [i.variantSku] : []))
      );
  const disponiblePorSku = new Map(
    [...estadoVivo].flatMap(([sku, v]) => (v.active ? [[sku, v.disponible] as const] : []))
  );
  const sobreElStock = lineasSobreElStock(quote.items, disponiblePorSku);
  // Total que vio el cliente: productos + personalizacion + preparacion del
  // logo + adicional por cantidad chica. El umbral es lo unico interno.
  // En centavos, como en /cotizar: el total cierra con las lineas mostradas.
  const subtotalImpresion = (p: (typeof quote.printings)[number]) =>
    aCentavos(p.unitPrice) * p.quantity +
    aCentavos(p.setupPrice) +
    aCentavos(p.surcharge ?? 0);
  const total =
    (quote.items.reduce(
      (sum, item) => sum + aCentavos(item.unitPrice) * item.quantity,
      0
    ) +
      quote.printings.reduce((sum, p) => sum + subtotalImpresion(p), 0)) /
    100;
  // Con o sin personalizacion decide el texto del umbral: sin ella no hay
  // recargo, solo el aviso de que lo llevaria si se personaliza.
  const conPersonalizacion = new Set(quote.printings.map((p) => p.productId));
  const descartadas = await getNombresDeProductos(quote.printingDroppedProductIds);

  return (
    <div>
      <Link
        href="/admin/cotizaciones"
        className="text-sm text-foreground/50 transition-colors hover:text-primary"
      >
        ← Volver
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-foreground">
            {quote.customerName}
          </h1>
          <p className="text-sm text-foreground/50">
            {/* El shortCode es el mismo que ve el cliente en su mensaje de
                WhatsApp — es la referencia para cruzar cuando escribe. */}
            <strong className="text-foreground/70">#{quote.shortCode}</strong>{" "}
            · {formatDateTime(quote.createdAt)}
          </p>
        </div>
        <QuoteStatusSelect quoteId={quote.id} initialStatus={quote.status} />
      </div>

      {quote.personalDataErasedAt && (
        <div className="mt-6 rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4 text-sm">
          <p className="font-medium text-foreground">
            Datos personales borrados el{" "}
            {formatDateTime(quote.personalDataErasedAt)} por{" "}
            {quote.personalDataErasedBy ?? "un super admin"}
          </p>
          {/* Lo que la base no puede borrar: el aviso que llego por mail. */}
          <p className="mt-1 text-foreground/60">
            Falta borrar a mano el aviso de esta cotización en la casilla de
            consultas (buscá #{quote.shortCode}) y vaciar la papelera. Resend
            lo elimina solo a los 30 días.
          </p>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-3">
        <section className="md:col-span-2">
          <h2 className="text-sm font-medium text-foreground/60">Items</h2>
          {/* overflow-x-auto y NO overflow-hidden: con `hidden`, en un celular
              las columnas que no entran quedan cortadas y sin ninguna forma de
              llegar a ellas. Acá lo que se perdía era el subtotal. */}
          <div className="mt-3 overflow-x-auto rounded-xl border border-foreground/10 bg-background">
            <table className="w-full min-w-[640px] text-sm">
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
                {quote.items.map((item, i) => (
                  <tr
                    key={item.id}
                    className="border-b border-foreground/5 last:border-0"
                  >
                    <td className="px-4 py-3 text-foreground">
                      {item.product.name}
                      {conRecargo.has(item.productId) && (
                        <span className="mt-0.5 block text-xs font-medium text-amber-700">
                          {textoUmbral(
                            conRecargo.get(item.productId)!,
                            conPersonalizacion.has(item.productId)
                          )}
                        </span>
                      )}
                      {sobreElStock[i] !== null && (
                        <span className="mt-0.5 block text-xs font-medium text-amber-700">
                          {textoPedidoMayorAlStock(sobreElStock[i]!)}
                        </span>
                      )}
                      {!cerrada && item.variantSku && !estadoVivo.get(item.variantSku)?.active && (
                        <span className="mt-0.5 block text-xs text-foreground/50">
                          {estadoVivo.has(item.variantSku)
                            ? "Variante inactiva: el proveedor dejó de mandarla"
                            : "Variante que ya no existe en el catálogo"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground/70">
                      {item.variantSku ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-foreground/70">
                      {item.quantity}
                    </td>
                    <td className="px-4 py-3 text-foreground/70">
                      {formatPriceArsCentavos(item.unitPrice)}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {formatPriceArsCentavos(
                        (aCentavos(item.unitPrice) * item.quantity) / 100
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {quote.printings.length > 0 && (
            <>
              <h2 className="mt-8 text-sm font-medium text-foreground/60">
                Personalización (estimada)
              </h2>
              <div className="mt-3 overflow-x-auto rounded-xl border border-foreground/10 bg-background">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-foreground/10 text-left text-xs text-foreground/50">
                      <th className="px-4 py-3 font-medium">Producto</th>
                      <th className="px-4 py-3 font-medium">Cant.</th>
                      <th className="px-4 py-3 font-medium">Unit.</th>
                      <th className="px-4 py-3 font-medium">Preparación</th>
                      <th className="px-4 py-3 font-medium">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.printings.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-foreground/5 last:border-0"
                      >
                        <td className="px-4 py-3 text-foreground">
                          {p.product.name}
                          <span className="mt-0.5 block text-xs text-foreground/60">
                            {p.publicLabel} · nivel {p.levelLabel}
                          </span>
                          {p.surcharge !== null && (
                            <span className="mt-0.5 block text-xs font-medium text-amber-700">
                              {LEYENDAS_PRECIO.adicionalCantidadChica}:{" "}
                              {formatPriceArsCentavos(p.surcharge)} (incluido en el
                              subtotal)
                              {conRecargo.has(p.productId) &&
                                ` · ${textoRecargoProveedor(conRecargo.get(p.productId)!)}`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground/70">{p.quantity}</td>
                        <td className="px-4 py-3 text-foreground/70">
                          {formatPriceArsCentavos(p.unitPrice)}
                        </td>
                        <td className="px-4 py-3 text-foreground/70">
                          {formatPriceArsCentavos(p.setupPrice)}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          {formatPriceArsCentavos(subtotalImpresion(p) / 100)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {descartadas.length > 0 && (
            <p className="mt-3 text-xs font-medium text-amber-700">
              {TEXTO_SELECCION_DESCARTADA} ({descartadas.join(", ")})
            </p>
          )}

          <p className="mt-3 text-right text-sm font-medium text-foreground">
            Total: {formatPriceArsCentavos(total)}{" "}
            <span className="text-foreground/50">+ IVA</span>
          </p>


          {quote.notes && (
            <div className="mt-8">
              <h2 className="text-sm font-medium text-foreground/60">Notas</h2>
              <p className="mt-2 whitespace-pre-wrap rounded-xl border border-foreground/10 bg-background p-4 text-sm text-foreground/80">
                {quote.notes}
              </p>
            </div>
          )}

          {history.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-medium text-foreground/60">
                Historial de este cliente ({quote.customerEmail})
              </h2>
              <div className="mt-3 flex flex-col gap-2">
                {history.map((h) => (
                  <Link
                    key={h.id}
                    href={`/admin/cotizaciones/${h.id}`}
                    className="flex items-center justify-between rounded-lg border border-foreground/10 bg-background px-4 py-3 text-sm transition-colors hover:border-primary"
                  >
                    <span className="text-foreground/70">
                      {formatDate(h.createdAt)} ·{" "}
                      {h.items.length} item(s)
                    </span>
                    <StatusBadge status={h.status} />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-6">
          <div>
            <h2 className="text-sm font-medium text-foreground/60">Contacto</h2>
            <dl className="mt-2 flex flex-col gap-1.5 text-sm">
              <Row label="Empresa" value={quote.companyName ?? "—"} />
              <Row label="Email" value={borrada ? "—" : quote.customerEmail} />
              <Row label="Teléfono" value={quote.customerPhone ?? "—"} />
            </dl>
          </div>

          <div>
            <h2 className="text-sm font-medium text-foreground/60">
              Logo / arte
            </h2>
            {quote.logoUrl ? (
              <a
                href={quote.logoUrl}
                className="mt-2 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
              >
                Descargar archivo
              </a>
            ) : (
              <p className="mt-2 text-sm text-foreground/50">
                {borrada
                  ? "Se borró junto con los datos personales."
                  : "No subió ningún archivo todavía."}
              </p>
            )}
          </div>

          {/* Solo super-admin: es irreversible. La accion lo vuelve a exigir. */}
          {!borrada && admin.role === AdminRole.SUPER_ADMIN && (
            <QuoteEraseButton quoteId={quote.id} shortCode={quote.shortCode} />
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-foreground/50">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}

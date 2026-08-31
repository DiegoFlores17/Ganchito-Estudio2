import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPriceArs } from "@/lib/format";
import { requireAdmin } from "@/lib/admin-auth";
import { getQuoteById, getQuoteHistoryByEmail } from "@/lib/admin-quotes";
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
  await requireAdmin();

  const { id } = await params;
  const quote = await getQuoteById(id);
  if (!quote) notFound();

  const history = await getQuoteHistoryByEmail(quote.customerEmail, quote.id);
  const total = quote.items.reduce(
    (sum, item) => sum + Number(item.unitPrice) * item.quantity,
    0
  );

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
            · {quote.createdAt.toLocaleString("es-AR")}
          </p>
        </div>
        <QuoteStatusSelect quoteId={quote.id} initialStatus={quote.status} />
      </div>

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
                {quote.items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-foreground/5 last:border-0"
                  >
                    <td className="px-4 py-3 text-foreground">
                      {item.product.name}
                    </td>
                    <td className="px-4 py-3 text-foreground/70">
                      {item.variantSku ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-foreground/70">
                      {item.quantity}
                    </td>
                    <td className="px-4 py-3 text-foreground/70">
                      {formatPriceArs(item.unitPrice)}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {formatPriceArs(Number(item.unitPrice) * item.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-right text-sm font-medium text-foreground">
            Total: {formatPriceArs(total)}{" "}
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
                      {h.createdAt.toLocaleDateString("es-AR")} ·{" "}
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
              <Row label="Email" value={quote.customerEmail} />
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
                No subió ningún archivo todavía.
              </p>
            )}
          </div>
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

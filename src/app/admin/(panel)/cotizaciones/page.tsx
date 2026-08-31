import { QuoteStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/admin-auth";
import { getQuotes } from "@/lib/admin-quotes";
import { StatusBadge } from "@/components/admin/status-badge";
import { QuoteFilters } from "@/components/admin/quote-filters";
import { QuoteRow } from "@/components/admin/quote-row";

const STATUS_OPTIONS: { value: QuoteStatus; label: string }[] = [
  { value: QuoteStatus.SUBMITTED, label: "Recibidas" },
  { value: QuoteStatus.QUOTED, label: "Cotizadas" },
  { value: QuoteStatus.ACCEPTED, label: "Aceptadas" },
  { value: QuoteStatus.REJECTED, label: "Rechazadas" },
];

export default async function CotizacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; status?: string }>;
}) {
  // La autorizacion no puede quedar solo en el layout: ver el comentario de
  // requireAdmin() en src/lib/admin-auth.ts.
  await requireAdmin();

  const params = await searchParams;
  const status = STATUS_OPTIONS.find((s) => s.value === params.status)?.value;
  // El param sigue llamandose "email" por compatibilidad con URLs guardadas,
  // pero busca email O shortCode (ver getQuotes).
  const search = params.email?.trim() || undefined;

  const quotes = await getQuotes({ search, status });

  return (
    <div>
      <h1 className="text-2xl font-medium text-foreground">Cotizaciones</h1>

      <QuoteFilters
        initialEmail={search}
        initialStatus={status}
        statusOptions={STATUS_OPTIONS}
      />

      <div className="mt-8 overflow-x-auto rounded-xl border border-foreground/10 bg-background">
        {/* Siete columnas, y Cliente/Empresa/Email son textos largos: con 720
            se comprimían y el email se partía en varias líneas. El scroll ya
            estaba bien resuelto acá; lo que faltaba era el piso de ancho. */}
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-xs text-foreground/50">
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Empresa</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Items</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((quote) => (
              // Los links que estaban escondidos en la fecha y en el nombre se
              // sacan: ahora la fila entera es el camino, y el "Ver" que
              // agrega QuoteRow es la señal visible de que se puede entrar.
              <QuoteRow
                key={quote.id}
                href={`/admin/cotizaciones/${quote.id}`}
              >
                <td className="px-4 py-3 text-foreground/70">
                  {quote.createdAt.toLocaleDateString("es-AR")}
                </td>
                <td className="px-4 py-3 font-medium text-foreground">
                  {quote.customerName}
                </td>
                <td className="px-4 py-3 text-foreground/70">
                  {quote.companyName ?? "—"}
                </td>
                <td className="px-4 py-3 text-foreground/70">
                  {quote.customerEmail}
                </td>
                <td className="px-4 py-3 text-foreground/70">
                  {quote.items.length}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={quote.status} />
                </td>
              </QuoteRow>
            ))}
          </tbody>
        </table>

        {quotes.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-foreground/50">
            No hay cotizaciones que coincidan con la búsqueda.
          </p>
        )}
      </div>
    </div>
  );
}

import Link from "next/link";
import { QuoteStatus } from "@prisma/client";
import { getQuotes } from "@/lib/admin-quotes";
import { StatusBadge } from "@/components/admin/status-badge";

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
  const params = await searchParams;
  const status = STATUS_OPTIONS.find((s) => s.value === params.status)?.value;
  const email = params.email?.trim() || undefined;

  const quotes = await getQuotes({ email, status });

  return (
    <div>
      <h1 className="text-2xl font-medium text-foreground">Cotizaciones</h1>

      <form className="mt-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-foreground/60">
            Buscar por email del cliente
          </label>
          <input
            type="text"
            name="email"
            defaultValue={email}
            placeholder="cliente@empresa.com"
            className="w-64 rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-foreground/60">Estado</label>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
        >
          Filtrar
        </button>
        {(email || status) && (
          <Link
            href="/admin/cotizaciones"
            className="text-sm text-foreground/50 transition-colors hover:text-primary"
          >
            Limpiar
          </Link>
        )}
      </form>

      <div className="mt-8 overflow-x-auto rounded-xl border border-foreground/10 bg-background">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-xs text-foreground/50">
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Empresa</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Items</th>
              <th className="px-4 py-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((quote) => (
              <tr
                key={quote.id}
                className="border-b border-foreground/5 last:border-0 hover:bg-foreground/[0.02]"
              >
                <td className="px-4 py-3 text-foreground/70">
                  <Link
                    href={`/admin/cotizaciones/${quote.id}`}
                    className="block"
                  >
                    {quote.createdAt.toLocaleDateString("es-AR")}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/cotizaciones/${quote.id}`}
                    className="font-medium text-foreground hover:text-primary"
                  >
                    {quote.customerName}
                  </Link>
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
              </tr>
            ))}
          </tbody>
        </table>

        {quotes.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-foreground/50">
            No hay cotizaciones que coincidan con la busqueda.
          </p>
        )}
      </div>
    </div>
  );
}

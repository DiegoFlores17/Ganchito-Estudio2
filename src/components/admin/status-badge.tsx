import { QuoteStatus } from "@prisma/client";

const STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Borrador",
  SUBMITTED: "Recibida",
  QUOTED: "Cotizada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  EXPIRED: "Vencida",
};

const STATUS_STYLES: Record<QuoteStatus, string> = {
  DRAFT: "bg-foreground/10 text-foreground/60",
  SUBMITTED: "bg-primary/10 text-primary",
  QUOTED: "bg-brand-phlox/15 text-primary-dark",
  ACCEPTED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-700",
  EXPIRED: "bg-foreground/10 text-foreground/50",
};

export function StatusBadge({ status }: { status: QuoteStatus }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

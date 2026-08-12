"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { QuoteStatus } from "@prisma/client";
import { updateQuoteStatus } from "@/app/admin/(panel)/cotizaciones/actions";

const OPTIONS: { value: QuoteStatus; label: string }[] = [
  { value: QuoteStatus.SUBMITTED, label: "Recibida" },
  { value: QuoteStatus.QUOTED, label: "Cotizada" },
  { value: QuoteStatus.ACCEPTED, label: "Aceptada" },
  { value: QuoteStatus.REJECTED, label: "Rechazada" },
  { value: QuoteStatus.EXPIRED, label: "Vencida" },
];

export function QuoteStatusSelect({
  quoteId,
  initialStatus,
}: {
  quoteId: string;
  initialStatus: QuoteStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as QuoteStatus;
    setStatus(next);
    setSaved(false);
    startTransition(async () => {
      await updateQuoteStatus(quoteId, next);
      setSaved(true);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <select
        value={status}
        onChange={handleChange}
        disabled={isPending}
        className="rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {isPending && (
        <span className="text-xs text-foreground/40">Guardando...</span>
      )}
      {saved && !isPending && (
        <span className="text-xs text-primary">Guardado</span>
      )}
    </div>
  );
}

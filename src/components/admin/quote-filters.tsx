"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface StatusOption {
  value: string;
  label: string;
}

/// Filtros de /admin/cotizaciones.
///
/// Antes era un <form method="GET"> nativo: filtrar disparaba una recarga
/// completa de la pagina sin ninguna señal, y con la tabla vieja en pantalla
/// no habia forma de saber si el click habia hecho algo. Ahora navega por el
/// router (soft navigation, igual que el resto del sitio) dentro de una
/// transicion, asi el boton puede avisar que esta filtrando.
export function QuoteFilters({
  initialEmail,
  initialStatus,
  statusOptions,
}: {
  initialEmail?: string;
  initialStatus?: string;
  statusOptions: StatusOption[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [status, setStatus] = useState(initialStatus ?? "");
  const [isPending, startTransition] = useTransition();

  const hasFilters = Boolean(email || status);

  function navigate(nextEmail: string, nextStatus: string) {
    const params = new URLSearchParams();
    if (nextEmail.trim()) params.set("email", nextEmail.trim());
    if (nextStatus) params.set("status", nextStatus);

    const query = params.toString();
    startTransition(() => {
      router.push(
        query ? `/admin/cotizaciones?${query}` : "/admin/cotizaciones"
      );
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(email, status);
  }

  function handleClear() {
    setEmail("");
    setStatus("");
    navigate("", "");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 flex flex-wrap items-end gap-4"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-foreground/60">
          Buscar por email o código
        </label>
        <input
          type="text"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="cliente@empresa.com o #A7F3C2"
          className="w-64 rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-foreground/60">Estado</label>
        <select
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todos</option>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {isPending ? "Filtrando..." : "Filtrar"}
      </button>

      {hasFilters && (
        <button
          type="button"
          onClick={handleClear}
          disabled={isPending}
          className="text-sm text-foreground/50 transition-colors hover:text-primary disabled:opacity-60"
        >
          Limpiar
        </button>
      )}
    </form>
  );
}

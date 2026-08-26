"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminRole } from "@prisma/client";
import { addAdmin, removeAdmin } from "@/app/admin/(panel)/equipo/actions";

interface AdminRow {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  createdAt: Date;
}

/// Que accion esta corriendo. Hay un solo useTransition para el alta y las
/// bajas, asi que isPending por si solo no alcanza: sin esto, sacar a una
/// persona pondria "Sacando..." en TODAS las filas de la tabla.
type PendingAction = { kind: "add" } | { kind: "remove"; id: string } | null;

export function TeamManagement({
  admins,
  currentAdminId,
}: {
  admins: AdminRow[];
  currentAdminId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  // No se limpia pendingAction al terminar: se lee SIEMPRE junto con
  // isPending, asi que cuando la transicion cierra, los botones vuelven solos
  // a su texto normal y el valor viejo queda inerte hasta la proxima accion.
  // Limpiarlo desde un efecto seria disparar un render en cascada al pedo.
  const addPending = isPending && pendingAction?.kind === "add";
  const removingId =
    isPending && pendingAction?.kind === "remove" ? pendingAction.id : null;

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    // onSubmit + preventDefault (no action={fn}): asi el formulario no se
    // resetea solo si el servidor rechaza el alta (ver bug de /cotizar).
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setError(null);
    setPendingAction({ kind: "add" });

    startTransition(async () => {
      const result = await addAdmin(formData);
      if (!result.success) {
        setError(result.error ?? "No se pudo agregar.");
        return;
      }
      form.reset();
      router.refresh();
    });
  }

  function handleRemove(adminId: string, email: string) {
    if (!window.confirm(`¿Sacar a ${email} del panel?`)) return;
    setError(null);
    setPendingAction({ kind: "remove", id: adminId });
    startTransition(async () => {
      const result = await removeAdmin(adminId);
      if (!result.success) {
        setError(result.error ?? "No se pudo sacar.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-end gap-4 rounded-xl border border-foreground/10 bg-background p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-foreground/60">Email</label>
          <input
            type="email"
            name="email"
            required
            className="w-64 rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-foreground/60">Nombre</label>
          <input
            type="text"
            name="name"
            className="w-48 rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-foreground/60">Rol</label>
          <select
            name="role"
            defaultValue={AdminRole.ADMIN}
            className="rounded-lg border border-foreground/15 px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value={AdminRole.ADMIN}>Admin</option>
            <option value={AdminRole.SUPER_ADMIN}>Super admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {addPending ? "Agregando..." : "Agregar"}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg bg-primary-dark/5 px-4 py-2 text-sm text-primary-dark">
          {error}
        </p>
      )}

      {/* overflow-x-auto y NO overflow-hidden: con `hidden`, en un celular
          las columnas que no entran quedan cortadas y sin ninguna forma de
          llegar a ellas — incluida la del botón de acción. El email es la
          columna que más empuja el ancho. */}
      <div className="mt-6 overflow-x-auto rounded-xl border border-foreground/10 bg-background">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-xs text-foreground/50">
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 font-medium">Alta</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => (
              <tr
                key={admin.id}
                className="border-b border-foreground/5 last:border-0"
              >
                <td className="px-4 py-3 text-foreground">
                  {admin.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-foreground/70">
                  {admin.email}
                  {admin.id === currentAdminId && (
                    <span className="ml-2 text-xs text-foreground/40">(vos)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-foreground/70">
                  {admin.role === AdminRole.SUPER_ADMIN ? "Super admin" : "Admin"}
                </td>
                <td className="px-4 py-3 text-foreground/50">
                  {admin.createdAt.toLocaleDateString("es-AR")}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleRemove(admin.id, admin.email)}
                    className="text-xs font-medium text-foreground/50 transition-colors hover:text-primary-dark disabled:opacity-60"
                  >
                    {removingId === admin.id ? "Sacando..." : "Sacar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

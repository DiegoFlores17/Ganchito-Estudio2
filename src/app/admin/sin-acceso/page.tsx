import { signOut } from "@/auth";

export default function SinAccesoPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-foreground/5 px-6 py-24">
      <div className="w-full max-w-sm rounded-2xl bg-background p-8 text-center shadow-sm">
        <h1 className="text-2xl font-black tracking-tight text-foreground">
          No tenés acceso a este panel
        </h1>
        <p className="mt-3 text-sm text-foreground/60">
          Tu cuenta de Google no está autorizada. Si te parece que es un
          error, pedile a un administrador que te agregue al equipo.
        </p>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/admin/login" });
          }}
          className="mt-8"
        >
          <button
            type="submit"
            className="w-full rounded-full border border-foreground/15 px-6 py-3 text-sm font-medium text-foreground/70 transition-colors hover:border-primary hover:text-primary"
          >
            Probar con otra cuenta
          </button>
        </form>
      </div>
    </div>
  );
}

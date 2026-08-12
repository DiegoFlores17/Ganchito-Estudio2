import { signIn } from "@/auth";

export default function AdminLoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-foreground/5 px-6 py-24">
      <div className="w-full max-w-sm rounded-2xl bg-background p-8 text-center shadow-sm">
        <p className="text-sm font-medium text-primary">Ganchito Estudio</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-foreground">
          Panel de administracion
        </h1>
        <p className="mt-3 text-sm text-foreground/60">
          Acceso exclusivo para el equipo de Ganchito.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/admin" });
          }}
          className="mt-8"
        >
          <button
            type="submit"
            className="w-full rounded-full bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
          >
            Continuar con Google
          </button>
        </form>
      </div>
    </div>
  );
}

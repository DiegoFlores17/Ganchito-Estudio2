"use client";

import { useFormStatus } from "react-dom";

/// Boton de "Continuar con Google" de /admin/login.
///
/// Va aparte del page como client component solo para poder usar
/// useFormStatus: el submit dispara un server action que redirige a Google, y
/// ese salto tarda lo suficiente como para que alguien clickee de nuevo. Se
/// lee el estado del <form> padre, asi la server action se queda donde estaba.
export function GoogleSignInButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
    >
      {pending ? "Redirigiendo a Google..." : "Continuar con Google"}
    </button>
  );
}

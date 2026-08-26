"use client";

import { useState, useTransition, type FormEvent } from "react";
import { updateSiteConfig } from "@/app/admin/(panel)/configuracion/actions";

/// Datos de contacto que se muestran en el footer y en el botón del hero.
export function SiteConfigForm({
  contactEmail,
  whatsappNumber,
  whatsappLabel,
  instagramHandle,
  address,
  openingHours,
}: {
  contactEmail: string;
  /// Los dígitos guardados. Se muestran ya formateados en el campo, pero al
  /// guardar se vuelven a normalizar, así que el admin puede tipear como
  /// quiera.
  whatsappNumber: string;
  whatsappLabel: string;
  instagramHandle: string;
  address: string;
  openingHours: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Mismo criterio que PricingConfigForm: preventDefault para que un
    // rechazo del servidor no borre lo que se tipeó.
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await updateSiteConfig(formData);
      if (!result.success) {
        setError(result.error ?? "No se pudo guardar.");
        return;
      }
      setSaved(true);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex max-w-md flex-col gap-6 rounded-xl border border-foreground/10 bg-background p-6"
    >
      <Campo
        label="Email"
        name="contactEmail"
        type="email"
        defaultValue={contactEmail}
        placeholder="hola@ganchitoestudio.com"
        ayuda="Se muestra en el footer y es el destino del botón Contacto si no hay WhatsApp."
      />

      <Campo
        label="WhatsApp"
        name="whatsappNumber"
        defaultValue={whatsappLabel || whatsappNumber}
        placeholder="+54 9 11 5555-1234"
        ayuda="Escribilo como quieras, con espacios o guiones. Tiene que llevar código de país, sin el 0 ni el 15."
      />

      <Campo
        label="Instagram"
        name="instagramHandle"
        defaultValue={instagramHandle ? `@${instagramHandle}` : ""}
        placeholder="@ganchitoestudio"
        ayuda="Podés poner el usuario o pegar el link del perfil."
      />

      <Campo
        label="Dirección o ciudad (opcional)"
        name="address"
        defaultValue={address}
        placeholder="Buenos Aires, Argentina"
      />

      <Campo
        label="Horarios de atención (opcional)"
        name="openingHours"
        defaultValue={openingHours}
        placeholder="Lunes a viernes de 9 a 18 h"
      />

      <p className="text-xs text-foreground/50">
        Los campos que dejes vacíos no se muestran en la tienda.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && !error && (
        <p className="text-sm text-primary">Datos de contacto guardados.</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {isPending ? "Guardando..." : "Guardar contacto"}
      </button>
    </form>
  );
}

function Campo({
  label,
  name,
  defaultValue,
  placeholder,
  ayuda,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder?: string;
  ayuda?: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="rounded-lg border border-foreground/15 px-4 py-2.5 text-sm outline-none focus:border-primary"
      />
      {ayuda && <p className="text-xs text-foreground/50">{ayuda}</p>}
    </div>
  );
}

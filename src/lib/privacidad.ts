/// Version vigente de la Politica de Privacidad (`/privacidad`).
///
/// Es la fecha del TEXTO, escrita a mano, en formato ISO. La usan la pagina
/// (para mostrar "Ultima actualizacion") y `submitQuote` (para guardar en
/// cada cotizacion que version acepto el cliente). Que salgan de la misma
/// constante es lo que impide que la fecha visible y la version registrada
/// diverjan.
///
/// Se mueve SOLO cuando cambia el contenido de la politica, nunca por un
/// deploy: no usar `new Date()`. Al cambiarla, las cotizaciones ya enviadas
/// conservan la version que aceptaron.
export const POLITICA_PRIVACIDAD_VERSION = "2026-10-28";

/// La misma fecha, legible, para la pagina.
export function formatearVersionPolitica(version: string): string {
  const [anio, mes, dia] = version.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(anio, mes - 1, dia)));
}

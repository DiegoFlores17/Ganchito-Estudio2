import { IsotipoGanchito } from "@/components/icons/isotipo-ganchito";
import { buildContactView, getSiteConfig } from "@/lib/site-config";

export async function Footer() {
  const contacto = buildContactView(await getSiteConfig());

  return (
    <footer className="bg-primary-dark text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="flex items-center gap-3">
          <IsotipoGanchito className="h-8 w-auto text-white" />
          <span className="text-lg font-medium">Ganchito Estudio</span>
        </div>

        {/* Si no hay ningun dato cargado, no se renderiza ni el titulo:
            "Contacto" solo, sin nada abajo, se lee como algo roto. */}
        {!contacto.isEmpty && (
          <div className="text-sm text-white/80">
            <p className="font-medium text-white">Contacto</p>

            {/* En mobile va en UNA columna y en desktop en dos: con cinco
                datos, una sola columna estira el footer de mas en desktop, y
                dos columnas en un telefono angosto parten los mails al medio.
                Por eso el corte es por ancho y no un layout fijo. */}
            <div className="mt-3 flex flex-col gap-x-10 gap-y-2 sm:flex-row sm:flex-wrap">
              <div className="flex flex-col gap-2">
                {contacto.links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    {...(link.external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    // break-all y no truncate: un mail largo en un telefono
                    // angosto tiene que poder leerse entero, aunque parta en
                    // dos lineas. Cortarlo con puntos suspensivos lo vuelve
                    // inservible, que es justo lo contrario de para que esta.
                    className="break-all transition-colors hover:text-accent"
                  >
                    {link.label}
                  </a>
                ))}
              </div>

              {contacto.texts.length > 0 && (
                <div className="flex flex-col gap-2 text-white/70">
                  {contacto.texts.map((text) => (
                    <p key={text}>{text}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-white/10 px-6 py-4 text-center text-xs text-white/60">
        © {new Date().getFullYear()} Ganchito Estudio. Todos los derechos
        reservados.
      </div>
    </footer>
  );
}

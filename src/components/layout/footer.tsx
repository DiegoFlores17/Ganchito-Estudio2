import { IsotipoGanchito } from "@/components/icons/isotipo-ganchito";
import {
  IconoEmail,
  IconoHorario,
  IconoInstagram,
  IconoUbicacion,
  IconoWhatsapp,
} from "@/components/icons/contact-icons";
import {
  buildContactView,
  getSiteConfig,
  type ContactKind,
} from "@/lib/site-config";

/// El icono se elige por el TIPO de dato, que viene de buildContactView, y no
/// adivinando por el contenido del texto.
const ICONOS: Record<ContactKind, (props: { className?: string }) => React.ReactElement> = {
  email: IconoEmail,
  whatsapp: IconoWhatsapp,
  instagram: IconoInstagram,
  address: IconoUbicacion,
  hours: IconoHorario,
};

/// Todos los iconos al mismo tamaño y con el mismo hueco reservado, para que
/// los textos queden alineados en una columna aunque los glifos tengan formas
/// distintas. `shrink-0` evita que se aplasten cuando el texto de al lado
/// parte en dos lineas en mobile.
const CLASES_ICONO = "h-[18px] w-[18px] shrink-0";

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
                {contacto.links.map((link) => {
                  const Icono = ICONOS[link.kind];
                  return (
                    <a
                      key={link.href}
                      href={link.href}
                      {...(link.external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      // items-start y no items-center: cuando el texto parte
                      // en dos lineas, el icono queda a la altura de la
                      // PRIMERA, que es donde el ojo lo busca.
                      className="group flex items-start gap-2.5 transition-colors hover:text-accent"
                    >
                      {/* El icono va a menos opacidad que el texto: identifica
                          el dato, no compite con el. Al hacer hover sube junto
                          con el texto, para que el link se lea como una sola
                          cosa. */}
                      <Icono
                        className={`${CLASES_ICONO} mt-0.5 text-white/60 transition-colors group-hover:text-accent`}
                      />
                      {/* break-all y no truncate: un mail largo en un telefono
                          angosto tiene que poder leerse entero, aunque parta
                          en dos lineas. */}
                      <span className="break-all">{link.label}</span>
                    </a>
                  );
                })}
              </div>

              {contacto.texts.length > 0 && (
                <div className="flex flex-col gap-2 text-white/70">
                  {contacto.texts.map((text) => {
                    const Icono = ICONOS[text.kind];
                    return (
                      <p key={text.value} className="flex items-start gap-2.5">
                        <Icono className={`${CLASES_ICONO} mt-0.5 text-white/60`} />
                        <span>{text.value}</span>
                      </p>
                    );
                  })}
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

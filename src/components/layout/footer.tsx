import { IsotipoGanchito } from "@/components/icons/isotipo-ganchito";

// TODO: reemplazar por los datos de contacto reales de Ganchito Estudio.
const CONTACT_EMAIL = "hola@ganchitoestudio.com";
const WHATSAPP_NUMBER = "5491100000000";
const WHATSAPP_LABEL = "+54 9 11 0000-0000";

export function Footer() {
  return (
    <footer className="bg-primary-dark text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-3">
          <IsotipoGanchito className="h-8 w-auto text-white" />
          <span className="text-lg font-medium">Ganchito Estudio</span>
        </div>

        <div className="flex flex-col gap-2 text-sm text-white/80">
          <p className="font-medium text-white">Contacto</p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="transition-colors hover:text-accent"
          >
            {CONTACT_EMAIL}
          </a>
          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}`}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-accent"
          >
            WhatsApp: {WHATSAPP_LABEL}
          </a>
        </div>
      </div>

      <div className="border-t border-white/10 px-6 py-4 text-center text-xs text-white/60">
        © {new Date().getFullYear()} Ganchito Estudio. Todos los derechos
        reservados.
      </div>
    </footer>
  );
}

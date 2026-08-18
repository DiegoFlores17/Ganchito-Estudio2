import Image from "next/image";
import Link from "next/link";
import { CartIndicator } from "./cart-indicator";
import { MobileNav } from "./mobile-nav";

/// Solo destinos que existen. Antes habia links a /como-funciona y /contacto,
/// dos paginas que nunca se crearon: eran links al 404 en TODAS las paginas de
/// la tienda, y en las dos versiones del nav, porque esta misma lista alimenta
/// al MobileNav.
///
/// "Como funciona" se recupera como ancla: el contenido ya existe como seccion
/// de la home (ver el id "como-funciona" en (store)/page.tsx), asi que no hace
/// falta una pagina aparte. Al ser un href absoluto con hash, funciona igual
/// desde cualquier ruta: navega a la home y scrollea a la seccion.
///
/// "Contacto" queda afuera a proposito: ya esta en el footer y competiria con
/// el CTA de cotizacion.
const NAV_LINKS = [
  { label: "Catálogo", href: "/catalogo" },
  { label: "Cómo funciona", href: "/#como-funciona" },
];

export function Header() {
  return (
    <header className="border-b border-black/5 bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
        <Link href="/" className="shrink-0">
          <Image
            src="/logo-ganchito.svg"
            alt="Ganchito Estudio"
            width={191}
            height={38}
            priority
          />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-foreground/80 transition-colors hover:text-primary-light"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/cotizar"
          className="hidden rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover md:inline-block"
        >
          Pedí tu cotización
        </Link>

        <div className="flex items-center gap-1">
          <CartIndicator />
          <MobileNav navLinks={NAV_LINKS} />
        </div>
      </div>
    </header>
  );
}

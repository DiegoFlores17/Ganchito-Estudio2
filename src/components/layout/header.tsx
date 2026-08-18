import Image from "next/image";
import Link from "next/link";
import { CartIndicator } from "./cart-indicator";
import { MobileNav } from "./mobile-nav";

/// Solo rutas que existen. "Como funciona" y "Contacto" apuntaban a
/// /como-funciona y /contacto, que nunca se crearon: eran dos links al 404 en
/// el header de TODAS las paginas de la tienda, y encima en desktop y mobile,
/// porque esta misma lista alimenta al MobileNav.
const NAV_LINKS = [{ label: "Catalogo", href: "/catalogo" }];

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
          Pedi tu cotizacion
        </Link>

        <div className="flex items-center gap-1">
          <CartIndicator />
          <MobileNav navLinks={NAV_LINKS} />
        </div>
      </div>
    </header>
  );
}

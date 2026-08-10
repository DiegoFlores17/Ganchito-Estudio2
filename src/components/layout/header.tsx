import Image from "next/image";
import Link from "next/link";

const NAV_LINKS = [
  { label: "Catalogo", href: "/catalogo" },
  { label: "Como funciona", href: "/como-funciona" },
  { label: "Contacto", href: "/contacto" },
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
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
        >
          Pedi tu cotizacion
        </Link>
      </div>
    </header>
  );
}

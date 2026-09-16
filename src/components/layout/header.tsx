import Image from "next/image";
import Link from "next/link";
import { CartIndicator } from "./cart-indicator";
import { CategoryMenu } from "./category-menu";
import { HeaderControls } from "./header-controls";
import { HeaderSearchDesktop } from "./header-search-desktop";
import { getMenuGroups } from "@/lib/catalog";

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

/// Server Component: hace UNA query de categorias y la comparte con el menu
/// desktop y el mobile. Sin cache por ahora — ver la nota de getMenuGroups().
export async function Header() {
  const menuGroups = await getMenuGroups();

  return (
    // `relative`: la fila de busqueda de mobile se posiciona contra este
    // elemento (top-full) para caer justo debajo de la barra.
    <header className="relative border-b border-black/5 bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4 lg:gap-6">
        <Link href="/" className="shrink-0">
          {/* El logo se achica en mobile, y no es estética: a 360px la barra
              tiene 312px de interior, el logo a 191 dejaba 121 para TRES
              controles de 40px (lupa, cotización con productos cargados, y
              hamburguesa) más sus gaps. Se desbordaba 15px — medido, con el
              carrito lleno, que es el caso donde aparecen los tres a la vez.

              A 150px el lockup sigue siendo legible y deja 10px de aire.
              `h-auto` acompaña al width variable: sin eso Next fija el alto
              del atributo y la imagen se deforma. */}
          <Image
            src="/logo-ganchito.svg"
            alt="Ganchito Estudio"
            width={191}
            height={38}
            priority
            className="h-auto w-[150px] sm:w-[191px]"
          />
        </Link>

        {/* El nav de escritorio aparece en `lg` (1024) y no en `md` (768).
            Medido: a 768 la barra ya estaba EXACTAMENTE llena antes de que
            existiera el buscador — los 720px disponibles se repartían entre
            logo (191), nav y cotización, y el nav se comprimía solo de 332 a
            292. Agregarle la lupa de 40px la desbordaba 2px.

            Así que entre 768 y 1024 se usa el patrón de mobile completo: lupa
            y hamburguesa, que ya resuelve nav y categorías en un panel con
            lugar de sobra. Desde 1024 entran las cuatro cosas. */}
        <nav className="hidden items-center gap-8 lg:flex">
          <CategoryMenu groups={menuGroups} />
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

        {/* Entre el nav y la cotización: es donde queda el espacio libre.
            Solo desde lg — a 768px la barra ya está exactamente llena. */}
        <HeaderSearchDesktop />

        {/* Un solo acceso a la cotización: CartIndicator decide si mostrar
            el CTA o el carrito con contador, según lo que haya cargado. Antes
            estaban los dos siempre y apuntaban al mismo lugar. */}
        <div className="flex items-center gap-2">
          <CartIndicator />
          <HeaderControls navLinks={NAV_LINKS} menuGroups={menuGroups} />
        </div>
      </div>
    </header>
  );
}

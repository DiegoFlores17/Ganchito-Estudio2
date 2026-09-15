"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { MenuGroup } from "@/lib/catalog";
import { CartIndicator } from "./cart-indicator";
import { GRUPO_SIN_AGRUPAR } from "@/lib/menu-groups";

/// Mismo tope que el menu desktop, por la misma razon: la fila de sueltas no
/// puede crecer sin control. En mobile pesa mas todavia — la lista es
/// vertical, asi que cuarenta items sueltos empujan el CTA de cotizacion
/// fuera de la pantalla.
const MAX_SUELTAS = 8;

interface NavLink {
  label: string;
  href: string;
}

export function MobileNav({
  navLinks,
  menuGroups,
}: {
  navLinks: NavLink[];
  /// Los mismos grupos que usa el menu desktop: la query la hace el Header y
  /// la comparte. Las categorias viven DENTRO de este panel y no en un
  /// componente aparte — en mobile no hace falta un desplegable sobre otro.
  menuGroups: MenuGroup[];
}) {
  const [open, setOpen] = useState(false);

  // Con el panel abierto, el scroll del body se bloquea.
  //
  // Sin esto el gesto movia la PAGINA DE ATRAS (que si desborda) mientras el
  // panel quedaba quieto — la mitad del sintoma de "scrollea pero no baja".
  //
  // El cleanup restaura el valor que habia, no fuerza "": si el bloqueo no se
  // libera, la pagina queda congelada y la unica salida es recargar. Corre
  // tambien al desmontar, asi que un cambio de ruta con el panel abierto
  // tampoco lo deja trabado.
  useEffect(() => {
    if (!open) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5"
      >
        <HamburgerIcon />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
            <Link href="/" onClick={() => setOpen(false)} className="shrink-0">
              <Image
                src="/logo-ganchito.svg"
                alt="Ganchito Estudio"
                width={191}
                height={38}
              />
            </Link>
            <div className="flex items-center gap-2">
              {/* El acceso a la cotizacion TIENE que estar aca dentro: el
                  panel es `fixed inset-0`, o sea que tapa el header entero —
                  incluido el CartIndicator. Sin esto, con el menu abierto no
                  hay ninguna forma de llegar a la cotizacion.
                  
                  Es el MISMO componente que el del header, no una copia: sigue
                  mostrando CTA o carrito con contador segun el estado, asi que
                  no son dos accesos distintos sino el mismo en el unico lugar
                  visible mientras el panel esta abierto. */}
              <CartIndicator soloEstado />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar menú"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5"
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* overflow-y-auto ACA, en el hijo flex-1, y no en el panel: el
              panel es `fixed inset-0 flex flex-col`, asi que su altura es la
              del viewport y es este nav el que crece con el contenido. Sin
              esto el nav se salia del panel —ningun contenedor recortaba— y el
              ultimo elemento quedaba fuera de la pantalla, inalcanzable: el
              gesto scrolleaba la PAGINA DE ATRAS, que si desborda, y por eso
              "scrollea pero no baja". */}
          <nav className="flex flex-1 flex-col overflow-y-auto px-6 py-8">
            {/* Bloque 1 — navegacion. 17px y no 24px: "Catálogo" no es mas
                importante que "Drinkware", es otra cosa. A 24px competia con
                el logo y dejaba dos capas de titulares peleando. */}
            <div className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="-mx-2 rounded-lg px-2 py-2 text-[17px] font-medium text-foreground transition-colors hover:text-primary"
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {menuGroups.length > 0 && (
              <>
                {/* Bloque 2 — categorias. Separador y no solo espacio: son
                    tres tipos de contenido distintos y tiene que verse donde
                    termina uno y empieza otro. */}
                <div className="mt-7 flex flex-col gap-5 border-t border-black/5 pt-7">
                  {menuGroups.map((grupo) => (
                    <div key={grupo.name ?? "sin-grupo"}>
                      {/* La jerarquia va al reves que antes: el GRUPO es lo
                          que organiza, asi que lleva el peso y el color de
                          marca; la categoria es regular e indentada debajo.
                          La indentacion hace visible la pertenencia sin lineas
                          ni cajas.

                          Sentence case, igual que el desplegable desktop: si
                          uno usa versalitas y el otro no, los dos menus dejan
                          de leerse igual. */}
                      <p className="text-[13px] font-semibold tracking-wide text-primary">
                        {grupo.name ?? GRUPO_SIN_AGRUPAR}
                      </p>
                      <div className="mt-1.5 flex flex-col gap-1">
                        {(grupo.name === null
                          ? grupo.categories.slice(0, MAX_SUELTAS)
                          : grupo.categories
                        ).map((c) => (
                          <Link
                            key={c.id}
                            href={`/catalogo?categoria=${c.slug}`}
                            onClick={() => setOpen(false)}
                            className="-mx-2 rounded-lg px-2 pl-4 text-[15px] text-foreground/75 transition-colors hover:text-primary"
                          >
                            {c.name}
                          </Link>
                        ))}
                        {grupo.name === null &&
                          grupo.categories.length > MAX_SUELTAS && (
                            <Link
                              href="/catalogo"
                              onClick={() => setOpen(false)}
                              className="-mx-2 rounded-lg px-2 pl-4 text-[15px] text-foreground/45"
                            >
                              y {grupo.categories.length - MAX_SUELTAS} más
                            </Link>
                          )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Bloque 3 — la salida al catalogo completo y el CTA.
                
                    El CTA SI va aca, y no duplica nada: en mobile el header no
                    lo muestra (no entra junto al logo, ver CartIndicator), asi
                    que este es el unico lugar donde existe. A ancho completo,
                    que es como si entra. */}
                <div className="mt-7 flex flex-col gap-5 border-t border-black/5 pt-7">
                  <Link
                    href="/catalogo"
                    onClick={() => setOpen(false)}
                    className="text-[15px] font-medium text-primary"
                  >
                    Ver todo el catálogo →
                  </Link>
                  <div onClick={() => setOpen(false)}>
                    <CartIndicator ctaAncho />
                  </div>
                </div>
              </>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

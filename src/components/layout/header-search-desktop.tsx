"use client";

import { usePathname } from "next/navigation";
import { SearchForm } from "./search-form";

/// La ruta que tiene buscador propio. En ella, el de la barra no se muestra.
///
/// **Por qué se oculta en vez de convivir:** el de /catalogo viene pre-cargado
/// con la búsqueda actual y el de la barra estaría vacío — dos campos en la
/// misma pantalla mostrando cosas distintas. Y tienen historial distinto: este
/// hace `push` (apila) y el de allá `replace` (no apila), así que usar uno u
/// otro dejaría un "atrás" impredecible en la misma página.
///
/// **Por qué no al revés (que este reemplace al del catálogo):** para
/// comportarse como aquel necesitaría leer `q` y `categoria` de la URL, o sea
/// `useSearchParams()` en un componente que vive en el layout. La doc de Next
/// (`use-search-params.md`, líneas 82 y 181) dice que en una ruta
/// prerenderizada eso hace que el árbol cliente hasta el `Suspense` más
/// cercano se renderice del lado del cliente, y que sin `Suspense` el build de
/// producción FALLA. Sería pagar eso en todas las páginas para arreglar una.
///
/// `usePathname` no arrastra esa restricción: solo la pide con
/// `cacheComponents` activado (`use-pathname.md:72`), que este proyecto no usa.
export const RUTA_CON_BUSCADOR_PROPIO = "/catalogo";

/// El buscador de la barra en desktop.
///
/// Aparece desde `lg` (1024px) y no desde `md` (768px) por una razón medida:
/// a 768 la barra ya está exactamente llena — logo, nav y cotización suman los
/// 720px disponibles y el nav ya se comprime solo. A 1024 quedan 238px libres.
/// Entre 768 y 1024 el acceso a la búsqueda es la lupa, igual que en mobile.
export function HeaderSearchDesktop() {
  const pathname = usePathname();
  if (pathname === RUTA_CON_BUSCADOR_PROPIO) return null;

  return (
    <SearchForm
      inputId="header-search"
      // flex-1 con min-w-0: absorbe el espacio que sobra hasta 320px y se
      // encoge sin empujar a nadie cuando no sobra. Sin min-w-0 un item flex
      // no baja de su contenido y fuerza desborde.
      className="hidden min-w-0 flex-1 lg:block lg:max-w-[320px]"
    />
  );
}

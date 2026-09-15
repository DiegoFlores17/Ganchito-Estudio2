"use client";

import { useEffect, useState } from "react";

/// Marcá con este atributo el botón que CIERRA la acción de una página, para
/// que la burbuja se corra del camino cuando está a la vista.
///
/// Se marca el botón en vez de deducirlo por ruta a propósito. Por ruta habría
/// que adivinar: el CTA puede estar fuera de pantalla porque el cliente está
/// arriba de la página, y la burbuja desaparecería sin motivo. Además, cada
/// página nueva con un CTA obligaría a venir a tocar este componente.
///
/// Si alguien agrega un CTA y se olvida del atributo, el peor caso es que la
/// burbuja quede siempre visible — el comportamiento de antes, no un bug.
export const ATRIBUTO_CTA = "data-cta-principal";

/// Burbuja flotante de WhatsApp.
///
/// Vive en el layout de la tienda, así que aparece en todas las páginas
/// públicas y en ninguna del panel: /admin tiene su propio layout.
export function WhatsappBubble({ href }: { href: string }) {
  // Se oculta mientras el CTA principal de la página está a la vista: es el
  // momento en que menos falta hace —el cliente está por cerrar el pedido— y
  // el único en que podría estorbarlo.
  //
  // Se OCULTA en vez de correrse hacia arriba: moverla la dejaría flotando en
  // medio del contenido, tapando otra cosa que nadie midió.
  const [ctaVisible, setCtaVisible] = useState(false);

  useEffect(() => {
    // Un solo observer para todos los CTA de la página, guardando CUÁLES están
    // a la vista. Con varios botones marcados, mirar solo el último evento
    // haría que uno que sale de pantalla "apague" el estado aunque otro siga
    // visible.
    //
    // Es un Set y no un contador (+1 / −1) a propósito: un contador guarda una
    // suma, no los hechos, así que un evento repetido lo deja desfasado para
    // siempre y la burbuja queda mal en la dirección que toque. El Set guarda
    // el estado de cada elemento, así que un evento repetido no cambia nada.
    const aLaVista = new Set<Element>();
    const observados = new WeakSet<Element>();

    const io = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.isIntersecting) aLaVista.add(e.target);
        else aLaVista.delete(e.target);
      }
      setCtaVisible(aLaVista.size > 0);
    });

    /// Engancha los CTA que haya en este momento y suelta los que ya no están.
    ///
    /// **Por qué no alcanza con buscarlos una vez al montar:** la burbuja vive
    /// en el layout, así que monta antes que el contenido de la página. El CTA
    /// puede aparecer despues — en /cotizar el botón de envío ni siquiera
    /// existe mientras dice "Cargando tu cotización…", porque el resumen se
    /// pide al servidor. Buscándolos una sola vez, ahí la burbuja no se
    /// escondía nunca. Verificado en el navegador, no razonado.
    function sincronizar() {
      for (const cta of document.querySelectorAll(`[${ATRIBUTO_CTA}]`)) {
        if (observados.has(cta)) continue;
        observados.add(cta);
        io.observe(cta);
      }
      // Un CTA que se va del DOM no genera evento de "ya no se ve", así que
      // quedaria marcado como visible para siempre y la burbuja no volveria.
      let cambio = false;
      for (const cta of aLaVista) {
        if (!cta.isConnected) {
          aLaVista.delete(cta);
          cambio = true;
        }
      }
      if (cambio) setCtaVisible(aLaVista.size > 0);
    }

    sincronizar();

    const mo = new MutationObserver(sincronizar);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <a
      href={href}
      target="_blank"
      // noopener: sin esto, la pestaña de WhatsApp puede tocar window.opener.
      rel="noopener noreferrer"
      // El ícono solo no dice nada a un lector de pantalla.
      aria-label="Escribinos por WhatsApp"
      // z-40 y no z-50: TODOS los overlays del sitio (menú hamburguesa, panel
      // de filtros mobile, desplegable de categorías) usan z-50, así que con
      // esto la burbuja queda debajo de cualquiera de ellos sin necesidad de
      // compartir estado entre componentes que hoy no se conocen.
      className={
        "fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-opacity hover:opacity-90 " +
        // `pointer-events-none` además de invisible: si solo bajara la
        // opacidad, seguiría interceptando el toque justo encima del CTA.
        (ctaVisible ? "pointer-events-none opacity-0" : "opacity-100")
      }
      // Mientras está oculta tampoco debe ser alcanzable por teclado.
      aria-hidden={ctaVisible}
      tabIndex={ctaVisible ? -1 : undefined}
    >
      <IconoWhatsapp />
    </a>
  );
}

/// SVG inline y no una imagen: sin request extra, sin depender de un host
/// externo, y toma el color del texto.
function IconoWhatsapp() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 016.988 2.896 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.945c0 2.096.549 4.142 1.595 5.945L0 24l6.305-1.654a11.94 11.94 0 005.71 1.454h.006c6.585 0 11.946-5.36 11.948-11.946A11.86 11.86 0 0020.52 3.45" />
    </svg>
  );
}

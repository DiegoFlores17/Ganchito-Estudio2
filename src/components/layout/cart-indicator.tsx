"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getQuoteCart, QUOTE_CART_EVENT } from "@/lib/quote-cart";

/// El UNICO acceso a la cotización en el header, y cambia de forma según el
/// estado.
///
/// Antes convivían el carrito y el botón "Pedí tu cotización": los dos
/// llevaban a /cotizar, así que ocupaban lugar dos veces para lo mismo. Pero
/// no cumplen la misma función y por eso se unifican en vez de borrar uno —
/// el carrito es ESTADO (cuántos productos hay cargados) y el CTA es
/// INVITACIÓN (qué hacer si recién llegás):
///
///   - carrito vacío  -> "Pedí tu cotización", el CTA que necesita quien llega
///   - con productos  -> ícono con el contador, el estado que necesita quien
///                       ya está armando el pedido
///
/// Con uno solo, además, deja de hacer falta duplicar el CTA adentro del panel
/// mobile: el acceso vive en el header y está siempre a la vista.
export function CartIndicator({
  soloEstado = false,
  ctaAncho = false,
}: {
  /// No mostrar nada cuando el carrito esta vacio. Lo usa el menu mobile:
  /// quien abrio el menu esta navegando, y si no hay nada cargado no hay
  /// cotizacion que ver.
  soloEstado?: boolean;
  /// CTA a ancho completo, para el final del panel mobile. Implica lo
  /// inverso de `soloEstado`: con productos cargados no muestra nada, porque
  /// el carrito ya esta arriba en la barra del panel. Entre los dos modos
  /// cubren los dos estados sin que nunca aparezcan juntos.
  ctaAncho?: boolean;
} = {}) {
  const [count, setCount] = useState(0);
  // El carrito vive en localStorage, así que en el primer render del server
  // no existe. Sin esto, el header se pinta como "vacío" y salta a "con
  // productos" apenas hidrata — peor que esperar un instante.
  const [listo, setListo] = useState(false);

  useEffect(() => {
    function sync() {
      setCount(getQuoteCart().length);
      setListo(true);
    }
    sync();
    window.addEventListener(QUOTE_CART_EVENT, sync);
    // El evento "storage" nativo cubre el caso de otra pestana abierta.
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(QUOTE_CART_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Mientras no se sabe, se muestra el CTA: es lo que corresponde al caso más
  // común (carrito vacío) y no se ve como un hueco si tarda.
  const conProductos = listo && count > 0;

  // En modo `soloEstado` (dentro del menu mobile) no se muestra el CTA: si el
  // carrito esta vacio no hay cotizacion que ver, y el cliente que abrio el
  // menu esta navegando, no revisando su pedido. El CTA lo espera en el header
  // al cerrar.
  //
  // Ademas no entra: el CTA de texto junto al logo del panel suma 398px en una
  // barra de 389 — se desborda en cualquier celular.
  if (soloEstado && !conProductos) return null;
  // Y al reves: el CTA del final del panel desaparece cuando hay productos,
  // porque en ese caso la barra de arriba ya muestra el carrito. Sin esto se
  // veian dos accesos en el mismo panel.
  if (ctaAncho && conProductos) return null;

  if (!conProductos) {
    return (
      <Link
        href="/cotizar"
        className={
          ctaAncho
            ? "block rounded-full bg-accent px-6 py-3.5 text-center text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
            : // `hidden md:inline-block`: en MOBILE este CTA no se muestra.
              //
              // No es una preferencia estetica, es que no entra: junto al logo
              // (191px) y al hamburguesa (40px) suma 391px de contenido mas 48
              // de padding, en una pantalla de 390. Medido — provocaba 64px de
              // scroll horizontal a 390 y 94px a 360, en TODO el sitio.
              //
              // En mobile el CTA vive al final del panel del hamburguesa, a
              // ancho completo, y en el header queda solo el carrito cuando
              // hay algo cargado.
              "hidden shrink-0 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover md:inline-block"
        }
      >
        Pedí tu cotización
      </Link>
    );
  }

  return (
    <Link
      href="/cotizar"
      aria-label={`Ver mi cotización (${count} ${count === 1 ? "producto" : "productos"})`}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5"
    >
      <CartIcon />
      <span className="absolute right-0 top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-white">
        {count}
      </span>
    </Link>
  );
}

function CartIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6h15l-1.5 9h-12z" />
      <path d="M6 6 5 3H2" />
      <circle cx="9.5" cy="19.5" r="1.5" />
      <circle cx="17.5" cy="19.5" r="1.5" />
    </svg>
  );
}

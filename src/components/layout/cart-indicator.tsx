"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getQuoteCart, QUOTE_CART_EVENT } from "@/lib/quote-cart";

export function CartIndicator() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    function sync() {
      setCount(getQuoteCart().length);
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

  return (
    <Link
      href="/cotizar"
      aria-label={
        count > 0
          ? `Ver mi cotización (${count} ${count === 1 ? "producto" : "productos"})`
          : "Ver mi cotización"
      }
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5"
    >
      <CartIcon />
      {count > 0 && (
        <span className="absolute right-0 top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-white">
          {count}
        </span>
      )}
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

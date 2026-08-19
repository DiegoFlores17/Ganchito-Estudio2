"use client";

import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { useLinkStatus } from "next/link";

/// Fila de la tabla de cotizaciones: clickeable entera, con un "Ver" visible.
///
/// Antes el unico camino al detalle eran dos links escondidos en la fecha y en
/// el nombre del cliente, que se renderizan igual que texto comun. Peor: solo
/// 2 de las 6 celdas eran clickeables, asi que la fila parecia clickeable y no
/// lo era segun donde le pegaras.
///
/// El click en la fila NO navega por su cuenta: dispara el <Link> del "Ver".
/// Asi hay un solo camino de navegacion y una sola fuente para el estado de
/// carga (useLinkStatus, que solo funciona dentro del Link). Si la fila
/// llamara a router.push por separado, habria dos caminos que mantener y el
/// boton no se enteraria cuando entras clickeando la fila.
export function QuoteRow({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const linkRef = useRef<HTMLAnchorElement>(null);

  function handleRowClick(event: React.MouseEvent<HTMLTableRowElement>) {
    // Si el click ya cayo sobre el link (o sobre cualquier control que se
    // agregue mas adelante), dejarlo pasar: no queremos disparar dos veces.
    if ((event.target as HTMLElement).closest("a, button")) return;
    linkRef.current?.click();
  }

  return (
    <tr
      onClick={handleRowClick}
      className="cursor-pointer border-b border-foreground/5 transition-colors last:border-0 hover:bg-primary/[0.04]"
    >
      {children}
      <td className="px-4 py-3 text-right">
        {/* El Link es el control real: es el que se puede tabular, abrir en
            pestaña nueva y copiar. El click en la fila es una comodidad
            encima, no el mecanismo. */}
        <Link
          ref={linkRef}
          href={href}
          className="inline-block rounded-lg border border-foreground/15 transition-colors hover:border-primary"
        >
          <VerLabel />
        </Link>
      </td>
    </tr>
  );
}

function VerLabel() {
  const { pending } = useLinkStatus();

  return (
    <span
      className={
        // min-w fijo para que "Abriendo..." no ensanche la celda y mueva la
        // tabla. pointer-events-none mientras navega: es lo que de verdad
        // evita el segundo click, porque un <a> no se puede deshabilitar.
        "block min-w-[5.5rem] px-3 py-1.5 text-center text-xs font-medium transition-colors " +
        (pending
          ? "pointer-events-none text-foreground/40"
          : "text-foreground/80")
      }
    >
      {pending ? "Abriendo..." : "Ver"}
    </span>
  );
}

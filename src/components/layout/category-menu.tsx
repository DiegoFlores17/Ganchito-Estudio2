"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MenuGroup } from "@/lib/catalog";

/// Cuantas categorias sueltas se muestran en la fila secundaria antes de
/// cortar. El resto queda detras del link al catalogo.
///
/// La fila es para las que nadie agrupo: hoy son pocas, pero nada impide que
/// el cliente deje quince sin agrupar y la fila se convierta en un muro de
/// texto que tapa a los grupos, que son lo curado. El tope existe para que el
/// menu no pueda degradarse solo.
///
/// Se muestran las de MAS productos: si hay que elegir ocho de veinte, las
/// utiles son las que tienen algo adentro.
const MAX_SUELTAS = 8;

/// Desplegable de categorias del header (desktop).
///
/// Los datos llegan por props: la query la hace el Header, que es Server
/// Component, y la comparte con el menu mobile. Una sola consulta para los dos.
export function CategoryMenu({ groups }: { groups: MenuGroup[] }) {
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(0);
  const contenedor = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  // Cerrar al hacer click afuera y con Escape. Sin esto, el panel queda
  // abierto tapando la pagina y la unica forma de cerrarlo es volver al boton.
  useEffect(() => {
    if (!open) return;

    function alClickear(e: MouseEvent) {
      if (!contenedor.current?.contains(e.target as Node)) setOpen(false);
    }
    function alTeclear(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", alClickear);
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("mousedown", alClickear);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [open]);

  /// El panel se posiciona respecto del VIEWPORT, no del boton.
  ///
  /// Antes era `absolute` centrado en el boton, y por eso se desbordaba: el
  /// contenedor de referencia mide lo que mide el boton, asi que un panel de
  /// 56rem centrado ahi se sale por los dos lados — con nombres largos como
  /// "Hogar y Tiempo Libre" quedaban cortados contra los bordes.
  ///
  /// Con `fixed` + ancho acotado al viewport, el panel no puede desbordarse
  /// por definicion, y el ancho de las columnas se adapta al espacio real.
  /// El `top` se MIDE del boton en vez de hardcodear la altura del header:
  /// asi no se despega si el header cambia de alto.
  function abrir() {
    const r = boton.current?.getBoundingClientRect();
    if (r) setTop(r.bottom + 12);
    setOpen((v) => !v);
  }

  if (groups.length === 0) return null;

  const agrupadas = groups.filter((g) => g.name !== null);
  const sueltasTodas = groups.find((g) => g.name === null)?.categories ?? [];
  const sueltas = sueltasTodas.slice(0, MAX_SUELTAS);
  const sueltasDeMas = sueltasTodas.length - sueltas.length;

  return (
    <div ref={contenedor}>
      <button
        ref={boton}
        type="button"
        onClick={abrir}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-1 text-sm font-medium text-foreground/80 transition-colors hover:text-primary-light"
      >
        Categorías
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={
            "h-4 w-4 transition-transform " + (open ? "rotate-180" : "")
          }
        >
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          className="fixed left-1/2 z-50 w-[min(72rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-2xl border border-black/5 bg-background p-6 shadow-xl"
          style={{
            top,
            // Si la pantalla es baja (o hay muchisimas categorias), el panel
            // scrollea en vez de crecer fuera de la ventana.
            maxHeight: `calc(100vh - ${top}px - 1rem)`,
          }}
        >
          {/* auto-fit + minmax: las columnas se adaptan al ancho REAL
              disponible. En una ventana angosta entran menos por fila y bajan,
              en vez de aplastarse hasta cortar los nombres. El minimo de 11rem
              es lo que necesita "Hogar y Tiempo Libre" sin partirse. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-8 gap-y-6">
            {agrupadas.map((grupo) => (
              <div key={grupo.name}>
                <p className="mb-2 text-xs font-semibold tracking-wide text-foreground/40">
                  {grupo.name}
                </p>
                <ul className="flex flex-col gap-1">
                  {grupo.categories.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/catalogo?categoria=${c.slug}`}
                        onClick={() => setOpen(false)}
                        className="-mx-2 block rounded-md px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-primary/5 hover:text-primary"
                      >
                        {c.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Las sueltas: las visibles que nadie agrupo. Fila secundaria, no
              ausencia — una categoria nueva que alguien publica sin agrupar
              tiene que aparecer en algun lado. */}
          {sueltas.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/5 pt-4">
              {sueltas.map((c) => (
                <Link
                  key={c.id}
                  href={`/catalogo?categoria=${c.slug}`}
                  onClick={() => setOpen(false)}
                  className="text-sm text-foreground/60 transition-colors hover:text-primary"
                >
                  {c.name}
                </Link>
              ))}
              {sueltasDeMas > 0 && (
                <Link
                  href="/catalogo"
                  onClick={() => setOpen(false)}
                  className="text-sm text-foreground/40 transition-colors hover:text-primary"
                >
                  y {sueltasDeMas} más
                </Link>
              )}
            </div>
          )}

          <div className="mt-5 border-t border-black/5 pt-4">
            <Link
              href="/catalogo"
              onClick={() => setOpen(false)}
              className="inline-block whitespace-nowrap text-sm font-medium text-primary transition-colors hover:text-primary-light"
            >
              Ver todo el catálogo →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

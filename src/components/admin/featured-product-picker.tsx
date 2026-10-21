"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { buscarProductosParaFijar } from "@/app/admin/(panel)/destacados/actions";
import type { ProductoParaFijar } from "@/lib/destacados-admin";
import { formatPriceArs } from "@/lib/format";
import { isOptimizableImage } from "@/lib/product-image";

const MINIMO = 2;
const ESPERA_MS = 300;

/// Lo que devolvio la busqueda de UNA consulta. Se guarda con su texto: si el
/// usuario siguio tipeando, el resultado viejo no se muestra como si fuera
/// el de ahora.
type Respuesta =
  | { consulta: string; productos: ProductoParaFijar[]; error: null }
  | { consulta: string; productos: []; error: string };

/// Selector de producto para una posicion de la portada. Usa el <dialog>
/// nativo en modo modal: la plataforma ya resuelve el foco atrapado, Escape y
/// el fondo inerte. En celular (hasta 640px) ocupa toda la pantalla.
export function FeaturedProductPicker({
  posicion,
  onElegir,
  onCerrar,
}: {
  posicion: number;
  onElegir: (productId: string) => void;
  onCerrar: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState("");
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  // Cada busqueda lleva un numero: si llega una respuesta vieja despues de una
  // nueva (la red no garantiza el orden), se descarta.
  const secuencia = useRef(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // showModal() le da el foco al primer boton ("Cerrar") y pisa el autoFocus
    // del campo, que ya se aplico al montar: hay que pedirlo despues de abrir.
    inputRef.current?.focus();
    // El dialogo modal no bloquea el scroll del fondo.
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflowPrevio;
    };
  }, []);

  const limpio = texto.trim();
  const corto = limpio.length < MINIMO;
  const vigente = respuesta?.consulta === limpio ? respuesta : null;

  useEffect(() => {
    if (limpio.length < MINIMO) return;
    const actual = ++secuencia.current;
    const espera = setTimeout(async () => {
      let nueva: Respuesta;
      try {
        const r = await buscarProductosParaFijar(limpio);
        nueva = r.success
          ? { consulta: limpio, productos: r.productos, error: null }
          : { consulta: limpio, productos: [], error: r.error };
      } catch {
        nueva = { consulta: limpio, productos: [], error: "No se pudo buscar. Probá de nuevo." };
      }
      if (actual === secuencia.current) setRespuesta(nueva);
    }, ESPERA_MS);
    return () => clearTimeout(espera);
  }, [limpio]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`buscar-titulo-${posicion}`}
      onClose={onCerrar}
      onClick={(e) => {
        // Click en el fondo (el <dialog> mismo, no su contenido): cerrar.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="m-auto w-full max-w-lg rounded-xl bg-background p-0 text-foreground backdrop:bg-foreground/40 max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none"
    >
      <div className="flex h-full max-h-[85dvh] flex-col max-sm:max-h-none">
        <div className="flex items-center justify-between gap-3 border-b border-foreground/10 p-4">
          <h2 id={`buscar-titulo-${posicion}`} className="text-base font-medium">
            Elegir producto para la posición {posicion}
          </h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="min-h-11 shrink-0 rounded-full px-4 text-sm font-medium text-foreground/70 hover:bg-foreground/5"
          >
            Cerrar
          </button>
        </div>

        <div className="p-4 pb-2">
          <label htmlFor={`buscar-${posicion}`} className="sr-only">
            Buscar por nombre o código
          </label>
          <input
            id={`buscar-${posicion}`}
            ref={inputRef}
            type="search"
            autoComplete="off"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Nombre, código o SKU"
            className="min-h-11 w-full rounded-lg border border-foreground/15 px-4 text-sm outline-none focus:border-primary"
          />
        </div>

        <div className="min-h-40 flex-1 overflow-y-auto p-4 pt-2" aria-live="polite">
          {corto && (
            <p className="py-6 text-center text-sm text-foreground/50">
              Escribí al menos {MINIMO} letras.
            </p>
          )}
          {!corto && !vigente && (
            <p className="py-6 text-center text-sm text-foreground/50">Buscando...</p>
          )}
          {!corto && vigente?.error && (
            <p className="rounded-lg bg-primary-dark/5 px-4 py-2 text-sm text-primary-dark">
              {vigente.error}
            </p>
          )}
          {!corto && vigente && !vigente.error && vigente.productos.length === 0 && (
            <p className="py-6 text-center text-sm text-foreground/50">
              No hay productos con ese nombre.
            </p>
          )}
          {!corto && vigente && vigente.productos.length > 0 && (
            <ul className="flex flex-col gap-2">
              {vigente.productos.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onElegir(p.id);
                      dialogRef.current?.close();
                    }}
                    className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-foreground/10 p-2 text-left hover:border-primary/40 hover:bg-primary/5"
                  >
                    <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-foreground/5">
                      {p.imageUrl && (
                        <Image
                          src={p.imageUrl}
                          alt=""
                          fill
                          sizes="56px"
                          unoptimized={!isOptimizableImage(p.imageUrl)}
                          className="object-contain"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-foreground/60">
                        {p.categoryName ?? "Sin categoría"}
                      </span>
                      <span className="block text-sm">
                        {p.desde ? "Desde " : ""}
                        {formatPriceArs(p.precio)}
                      </span>
                      {(!p.tieneStock || p.fijadoEn !== null) && (
                        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-primary-dark">
                          {!p.tieneStock && <span>Sin stock</span>}
                          {p.fijadoEn !== null && (
                            <span>
                              {p.fijadoEn === posicion
                                ? "Ya fijado en esta posición"
                                : `Ya fijado en la posición ${p.fijadoEn}`}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </dialog>
  );
}

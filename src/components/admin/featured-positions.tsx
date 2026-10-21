"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  fijarDestacado,
  moverDestacado,
  soltarDestacado,
} from "@/app/admin/(panel)/destacados/actions";
import { FeaturedProductPicker } from "@/components/admin/featured-product-picker";
import type {
  AdvertenciaFijado,
  EtapaDestacado,
  MotivoOmitido,
} from "@/lib/destacados";
import { isOptimizableImage } from "@/lib/product-image";

/// Lo que la pagina (servidor) le pasa a cada tarjeta. Todo serializable: el
/// precio ya viene formateado porque un Decimal no cruza al cliente.
export interface PosicionVM {
  posicion: number;
  producto: {
    id: string;
    name: string;
    categoryName: string | null;
    imageUrl: string | null;
    precioTexto: string;
    colores: number;
    origen: "fijado" | "automatico";
    etapa: EtapaDestacado | null;
    advertencias: AdvertenciaFijado[];
  } | null;
}

export interface OmitidoVM {
  id: string;
  name: string;
  rank: number;
  motivo: MotivoOmitido;
}

const ETAPA: Record<EtapaDestacado, { texto: string; clases: string }> = {
  rango: { texto: "En rango", clases: "bg-primary/10 text-primary" },
  "relleno-precio": {
    texto: "Relleno: fuera de rango",
    clases: "bg-accent/40 text-foreground/80",
  },
  "relleno-categoria": {
    texto: "Relleno: categoría repetida",
    clases: "bg-foreground/10 text-foreground/60",
  },
};

const ADVERTENCIA: Record<AdvertenciaFijado, string> = {
  "sin-stock": "Sin stock disponible",
  "fuera-de-rango": "Fuera del rango de precio",
  "categoria-oculta": "Categoría oculta como filtro",
};

const MOTIVO: Record<MotivoOmitido, string> = {
  "pausado-eliminado": "Está pausado o eliminado",
  "sin-foto": "Se quedó sin foto principal",
  "sin-variantes": "No tiene variantes activas",
  "posicion-fuera-de-rango": "Su posición ya no existe en la portada",
};

const BOTON =
  "min-h-11 rounded-full border border-foreground/15 px-4 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50";

/// Flechas de posicion: se ven chicas (36 px) para no competir con las
/// acciones, pero el ::after estira el area tactil a 44 px.
const FLECHA =
  "relative inline-flex size-9 items-center justify-center rounded-full border border-foreground/15 text-sm text-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-30";

type Resultado = { success: boolean; error?: string };

export function FeaturedPositions({
  posiciones,
  omitidos,
}: {
  posiciones: PosicionVM[];
  omitidos: OmitidoVM[];
}) {
  // Un solo "en curso" para toda la lista: mover o fijar toca a mas de una
  // tarjeta (el vecino, el desplazado), asi que mientras algo corre no se deja
  // disparar otra accion sobre un estado que esta por cambiar.
  const [isPending, startTransition] = useTransition();
  const [enCurso, setEnCurso] = useState<number | null>(null);
  const [errores, setErrores] = useState<Record<number, string>>({});
  const total = posiciones.length;
  // Tarjeta a la que devolver el foco cuando la pagina se vuelva a dibujar con
  // el resultado: al fijar en un hueco, el boton que tenia el foco deja de
  // existir (el de la tarjeta vacia no es el "Cambiar" de la llena).
  const focoEn = useRef<number | null>(null);

  useEffect(() => {
    if (focoEn.current === null) return;
    const boton = document.querySelector<HTMLElement>(
      `[data-posicion="${focoEn.current}"] [data-primario]`
    );
    if (boton) {
      boton.focus();
      focoEn.current = null;
    }
  }, [posiciones]);

  function ejecutar(
    posicion: number,
    accion: () => Promise<Resultado>,
    foco: number | null = posicion
  ) {
    focoEn.current = foco;
    setErrores((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => Number(k) !== posicion)));
    setEnCurso(posicion);
    startTransition(async () => {
      try {
        const r = await accion();
        if (!r.success) {
          focoEn.current = null;
          setErrores((prev) => ({ ...prev, [posicion]: r.error ?? "No se pudo guardar." }));
        }
      } catch {
        focoEn.current = null;
        setErrores((prev) => ({ ...prev, [posicion]: "No se pudo guardar. Probá de nuevo." }));
      } finally {
        setEnCurso(null);
      }
    });
  }

  return (
    <>
      <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {posiciones.map((slot) => (
          <Tarjeta
            key={slot.posicion}
            slot={slot}
            total={total}
            ocupado={isPending}
            enCurso={enCurso === slot.posicion && isPending}
            error={errores[slot.posicion] ?? null}
            ejecutar={ejecutar}
          />
        ))}
      </ol>

      {omitidos.length > 0 && (
        <div className="mt-6 rounded-xl border border-accent bg-accent/20 p-4">
          <h3 className="text-sm font-medium text-foreground">
            Fijados que hoy no se muestran
          </h3>
          <p className="mt-1 text-xs text-foreground/60">
            La portada los salta y usa el automático en su lugar. Si vuelven a estar
            disponibles, reaparecen solos en su posición.
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {omitidos.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-medium text-foreground">
                    Posición {o.rank} · {o.name}
                  </p>
                  <p className="text-xs text-primary-dark">{MOTIVO[o.motivo]}</p>
                  {errores[-o.rank] && (
                    <p className="mt-1 text-xs text-primary-dark">{errores[-o.rank]}</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  // Clave negativa: el error no se mezcla con el de la tarjeta de esa posicion.
                  onClick={() => ejecutar(-o.rank, () => soltarDestacado(o.rank, o.id), null)}
                  className={BOTON}
                >
                  Volver a automático
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Tarjeta({
  slot,
  total,
  ocupado,
  enCurso,
  error,
  ejecutar,
}: {
  slot: PosicionVM;
  total: number;
  ocupado: boolean;
  enCurso: boolean;
  error: string | null;
  ejecutar: (posicion: number, accion: () => Promise<Resultado>, foco?: number | null) => void;
}) {
  const { posicion, producto } = slot;
  const [eligiendo, setEligiendo] = useState(false);
  const cambiarRef = useRef<HTMLButtonElement>(null);
  const fijado = producto?.origen === "fijado";

  function cerrarSelector() {
    setEligiendo(false);
    // Safari y Firefox en Mac no enfocan un boton al hacer click: se devuelve
    // el foco a mano, no se confia en el que restaura el <dialog>.
    cambiarRef.current?.focus();
  }

  const selector = eligiendo && (
    <FeaturedProductPicker
      posicion={posicion}
      onCerrar={cerrarSelector}
      onElegir={(id) => ejecutar(posicion, () => fijarDestacado(id, posicion))}
    />
  );

  if (!producto) {
    return (
      <li
        data-posicion={posicion}
        className="flex flex-col gap-3 rounded-xl border border-dashed border-foreground/15 p-3"
      >
        <p className="text-sm text-foreground/40">
          #{posicion} · Sin producto para esta posición
        </p>
        {error && <p className="text-xs text-primary-dark">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            ref={cambiarRef}
            data-primario
            type="button"
            disabled={ocupado}
            onClick={() => setEligiendo(true)}
            className={BOTON}
          >
            Elegir producto
          </button>
        </div>
        {selector}
      </li>
    );
  }

  return (
    <li
      data-posicion={posicion}
      aria-busy={enCurso}
      className={`flex flex-col gap-3 rounded-xl border bg-background p-3 ${
        fijado ? "border-primary/40" : "border-foreground/10"
      } ${enCurso ? "opacity-70" : ""}`}
    >
      <div className="flex gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-foreground/5">
          {producto.imageUrl && (
            <Image
              src={producto.imageUrl}
              alt=""
              fill
              sizes="80px"
              unoptimized={!isOptimizableImage(producto.imageUrl)}
              className="object-contain"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {/* Las flechas van junto al numero de posicion que mueven, siempre
              en el mismo lugar: en la fila de botones caian donde sobrara
              espacio y en mobile partian en dos lineas. */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-foreground/50">#{posicion}</p>
            {fijado && (
              <div className="-mr-1 -mt-1 flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={ocupado || posicion <= 1}
                  aria-label={`Subir a la posición ${posicion - 1}`}
                  onClick={() => ejecutar(posicion, () => moverDestacado(posicion, "arriba", producto.id), posicion - 1)}
                  className={FLECHA}
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  disabled={ocupado || posicion >= total}
                  aria-label={`Bajar a la posición ${posicion + 1}`}
                  onClick={() => ejecutar(posicion, () => moverDestacado(posicion, "abajo", producto.id), posicion + 1)}
                  className={FLECHA}
                >
                  <span aria-hidden="true">↓</span>
                </button>
              </div>
            )}
          </div>
          <p className="truncate text-sm font-medium text-foreground">{producto.name}</p>
          <p className="truncate text-xs text-foreground/60">
            {producto.categoryName ?? "Sin categoría"}
          </p>
          <p className="mt-1 text-sm text-foreground">
            {producto.precioTexto}{" "}
            <span className="text-xs text-foreground/50">
              · {producto.colores} {producto.colores === 1 ? "color" : "colores"}
            </span>
          </p>
          {fijado ? (
            <span className="mt-1.5 inline-block rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-white">
              Fijado
            </span>
          ) : (
            producto.etapa && (
              <span
                className={`mt-1.5 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${ETAPA[producto.etapa].clases}`}
              >
                {ETAPA[producto.etapa].texto}
              </span>
            )
          )}
        </div>
      </div>

      {fijado && producto.advertencias.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-primary-dark">
          {producto.advertencias.map((a) => (
            <li key={a}>{ADVERTENCIA[a]}</li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-primary-dark/5 px-3 py-2 text-xs text-primary-dark">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* Mismo boton (y misma key) en las dos versiones de la tarjeta, para
            que React lo conserve y el foco vuelva al lugar correcto. */}
        <button
          key="cambiar"
          ref={cambiarRef}
          data-primario
          type="button"
          disabled={ocupado}
          onClick={() => setEligiendo(true)}
          className={BOTON}
        >
          Cambiar
        </button>
        {fijado ? (
          <>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => ejecutar(posicion, () => soltarDestacado(posicion, producto.id))}
              className={BOTON}
            >
              Volver a automático
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => ejecutar(posicion, () => fijarDestacado(producto.id, posicion))}
            className={BOTON}
          >
            Dejar fijo
          </button>
        )}
      </div>
      {selector}
    </li>
  );
}

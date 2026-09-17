"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import {
  alternar,
  buildCatalogHref,
  COLORES_VISIBLES,
  formatearPeso,
  normalizarNombre,
  type CatalogFilterOptions,
  type CatalogFilters,
  type OpcionFiltro,
} from "@/lib/catalog-params";

/// El contenido de los filtros: precio, color y técnica.
///
/// Es el MISMO componente en desktop y en mobile. En desktop vive en un panel
/// colapsable debajo de las pills de categoría; en mobile, dentro del panel de
/// categorías que ya existía. Dos copias del mismo formulario terminan
/// divergiendo — una gana un filtro que la otra no tiene.
export function FiltersContent({
  filtros,
  opciones,
  onNavegar,
}: {
  filtros: CatalogFilters;
  opciones: CatalogFilterOptions;
  /// Lo usa el panel mobile para cerrarse cuando el cliente toca algo.
  onNavegar?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {/* Precio va SIN acordeón: son 90px, y colapsarlo cuesta un toque para
          ahorrar nada. */}
      <PrecioFiltro filtros={filtros} opciones={opciones} onNavegar={onNavegar} />

      <Faceta
        titulo="Color"
        cantidad={opciones.colores.length}
        // Abierta si tiene algo aplicado: con un filtro puesto y la sección
        // cerrada, el cliente ve la grilla recortada sin ver qué la recortó.
        abiertaPorDefecto={filtros.colores.length > 0}
      >
        <ChipsFiltro
          opciones={opciones.colores}
          seleccionados={filtros.colores}
          // Buscador en vez de "ver más": son 234 valores, y desplegarlos
          // enteros es otra pantalla y media de scroll. El campo filtra los
          // chips en el cliente, sin navegar.
          conBuscador
          visibles={COLORES_VISIBLES}
          conPunto
          hrefDe={(valor) =>
            buildCatalogHref(filtros, { colores: alternar(filtros.colores, valor) })
          }
          onNavegar={onNavegar}
        />
      </Faceta>

      <Faceta
        titulo="Técnica de aplicación"
        cantidad={opciones.tecnicas.length}
        abiertaPorDefecto={filtros.tecnicas.length > 0}
      >
        {/* Las 40 enteras, sin tope ni "ver más": adentro de una sección que
            el cliente abrió a propósito ya no estorban, y esconder la mitad
            detrás de otro click deja técnicas reales fuera de alcance. */}
        <ChipsFiltro
          opciones={opciones.tecnicas}
          seleccionados={filtros.tecnicas}
          hrefDe={(valor) =>
            buildCatalogHref(filtros, { tecnicas: alternar(filtros.tecnicas, valor) })
          }
          onNavegar={onNavegar}
        />
      </Faceta>
    </div>
  );
}

/// Una faceta colapsable.
///
/// **Por qué acordeón y no todo desplegado:** con las 40 técnicas a la vista,
/// esa sola sección medía 1030px y 24 filas en un teléfono de 390 — más de una
/// pantalla y media. El panel entero eran 1784px sobre 750 visibles, o sea 2,4
/// pantallas de scroll para llegar al final. Colapsadas, el panel arranca en
/// ~250px y el cliente abre solo la faceta que le interesa.
///
/// El número de opciones va en el encabezado a propósito: sin él, una sección
/// cerrada no dice si adentro hay tres cosas o cuarenta.
function Faceta({
  titulo,
  cantidad,
  abiertaPorDefecto,
  children,
}: {
  titulo: string;
  cantidad: number;
  abiertaPorDefecto: boolean;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(abiertaPorDefecto);
  if (cantidad === 0) return null;

  return (
    <div className="border-t border-foreground/10 py-1">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="flex w-full items-center gap-2 py-3 text-left"
      >
        <span className="text-sm font-medium text-foreground">{titulo}</span>
        <span className="text-sm text-foreground/40">{cantidad}</span>
        <span className="ml-auto text-foreground/40">
          <Chevron abierta={abierta} />
        </span>
      </button>
      {abierta && <div className="pb-4">{children}</div>}
    </div>
  );
}

function Chevron({ abierta }: { abierta: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      className={"transition-transform " + (abierta ? "rotate-180" : "")}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/// Los dos campos de precio.
///
/// Van en un `<form>` de verdad y no en chips: el precio es un valor libre, y
/// navegar en cada tecla mandaría al cliente a buscar "$1" mientras escribe
/// "$10.000". Se aplica al enviar.
///
/// Los demás filtros viajan como campos ocultos, así que el formulario
/// funciona aunque el JS no haya hidratado y sin perder lo que ya estaba
/// aplicado — el mismo criterio del buscador de la barra.
function PrecioFiltro({
  filtros,
  opciones,
  onNavegar,
}: {
  filtros: CatalogFilters;
  opciones: CatalogFilterOptions;
  onNavegar?: () => void;
}) {
  const router = useRouter();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const datos = new FormData(event.currentTarget);
    const leer = (campo: string) => {
      const bruto = String(datos.get(campo) ?? "").replace(/[^\d]/g, "");
      return bruto ? Number(bruto) : null;
    };
    router.push(
      buildCatalogHref(filtros, { precioMin: leer("precioMin"), precioMax: leer("precioMax") })
    );
    onNavegar?.();
  }

  return (
    <form action="/catalogo" method="get" onSubmit={handleSubmit}>
      <p className="text-sm font-medium text-foreground">Precio</p>

      {/* Los otros filtros, para la ruta sin JS. Sin esto, enviar el precio
          borraría la categoría, la búsqueda y los chips ya marcados. */}
      {filtros.q && <input type="hidden" name="q" value={filtros.q} />}
      {filtros.categoria && (
        <input type="hidden" name="categoria" value={filtros.categoria} />
      )}
      {filtros.colores.map((c) => (
        <input key={c} type="hidden" name="color" value={c} />
      ))}
      {filtros.tecnicas.map((t) => (
        <input key={t} type="hidden" name="tecnica" value={t} />
      ))}

      <div className="mt-2.5 flex items-center gap-2">
        <CampoPrecio
          name="precioMin"
          etiqueta="Precio desde"
          defaultValue={filtros.precioMin}
          placeholder={formatearPeso(opciones.precioPiso)}
        />
        <span aria-hidden className="text-foreground/40">
          —
        </span>
        <CampoPrecio
          name="precioMax"
          etiqueta="Precio hasta"
          defaultValue={filtros.precioMax}
          placeholder={formatearPeso(opciones.precioTecho)}
        />
        <button
          type="submit"
          className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
        >
          Aplicar
        </button>
      </div>
      <p className="mt-1.5 text-xs text-foreground/45">
        El catálogo va de {formatearPeso(opciones.precioPiso)} a{" "}
        {formatearPeso(opciones.precioTecho)}, sin IVA.
      </p>
    </form>
  );
}

function CampoPrecio({
  name,
  etiqueta,
  defaultValue,
  placeholder,
}: {
  name: string;
  etiqueta: string;
  defaultValue?: number;
  placeholder: string;
}) {
  return (
    <input
      name={name}
      // `text` con inputMode numérico y no `type="number"`: el number trae
      // flechitas de incremento que no sirven para un precio de cinco cifras,
      // y en desktop el scroll del mouse encima del campo lo cambia sin que
      // nadie lo pida.
      type="text"
      inputMode="numeric"
      defaultValue={defaultValue ?? ""}
      placeholder={placeholder}
      aria-label={etiqueta}
      className="w-full min-w-0 rounded-full border border-foreground/15 px-3.5 py-2 text-sm outline-none focus:border-primary"
    />
  );
}

/// Multi-selección como chips.
///
/// Cada chip es un `<Link>` a la URL resultante, no un checkbox con estado: el
/// estado del filtro vive en la URL, así que el link ES la acción. De paso
/// funciona sin JS, el "atrás" del navegador anda solo, y se puede abrir en
/// una pestaña nueva.
function ChipsFiltro({
  opciones,
  seleccionados,
  visibles,
  conPunto = false,
  conBuscador = false,
  hrefDe,
  onNavegar,
}: {
  opciones: OpcionFiltro[];
  seleccionados: string[];
  visibles?: number;
  conPunto?: boolean;
  /// Campo que filtra los chips EN EL CLIENTE, sin navegar. Es para facetas
  /// con muchísimos valores (color: 234), donde ni desplegar todo ni un "ver
  /// más" sirven.
  conBuscador?: boolean;
  hrefDe: (valor: string) => string;
  onNavegar?: () => void;
}) {
  const [texto, setTexto] = useState("");
  const buscando = conBuscador && texto.trim() !== "";

  // Se compara sobre el nombre NORMALIZADO, igual que el resto del filtro:
  // buscar "azul" tiene que encontrar "Azul Francia", y buscar "laser" tiene
  // que encontrar "Láser CO2".
  const filtradas = buscando
    ? opciones.filter((o) => o.valor.includes(normalizarNombre(texto)))
    : opciones;

  // Mientras se busca se muestran TODAS las coincidencias: el tope existe para
  // que la faceta no ocupe media pantalla de entrada, no para esconder lo que
  // el cliente acaba de pedir por nombre.
  //
  // Los seleccionados van siempre visibles aunque caigan fuera del tope: si el
  // cliente marcó un color poco frecuente y el chip desaparece, ve el catálogo
  // filtrado sin poder desmarcar lo que aplicó.
  const tope = buscando ? filtradas.length : (visibles ?? filtradas.length);
  const aMostrar = filtradas.filter(
    (o, i) => i < tope || seleccionados.includes(o.valor)
  );

  if (opciones.length === 0) return null;

  return (
    <div>
      {conBuscador && (
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={`Buscar entre ${opciones.length} colores`}
          aria-label="Buscar color"
          className="mb-3 w-full rounded-full border border-foreground/15 px-4 py-2 text-sm outline-none focus:border-primary sm:max-w-xs"
        />
      )}

      <div className="flex flex-wrap gap-2">
        {aMostrar.map((o) => {
          const activo = seleccionados.includes(o.valor);
          return (
            <Link
              key={o.valor}
              href={hrefDe(o.valor)}
              scroll={false}
              onClick={onNavegar}
              aria-pressed={activo}
              className={
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors " +
                (activo
                  ? "border-primary bg-primary text-white"
                  : "border-foreground/15 text-foreground/80 hover:border-primary hover:text-primary")
              }
            >
              {conPunto && o.hex && (
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full border border-black/15"
                  style={{ backgroundColor: o.hex }}
                />
              )}
              <span>{o.etiqueta}</span>
              <span className={activo ? "text-white/70" : "text-foreground/40"}>
                {o.productos}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Sin coincidencias: decirlo. Un hueco en blanco debajo del buscador
          parece que la búsqueda no hizo nada. */}
      {buscando && aMostrar.length === 0 && (
        <p className="text-sm text-foreground/50">
          Ningún color coincide con “{texto.trim()}”.
        </p>
      )}

      {/* Nota discreta cuando hay más que el tope, en vez de un "ver más": el
          camino para llegar al resto es el buscador de arriba. */}
      {!buscando && visibles !== undefined && filtradas.length > tope && (
        <p className="mt-2.5 text-xs text-foreground/45">
          Se muestran los {tope} más usados. Buscá arriba para ver el resto.
        </p>
      )}
    </div>
  );
}

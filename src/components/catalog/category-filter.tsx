"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MenuGroup } from "@/lib/catalog";
import { GRUPO_SIN_AGRUPAR } from "@/lib/menu-groups";
import { CategoryChip, PanelRow } from "@/components/catalog/link-content";
import { FiltersContent } from "@/components/catalog/filters-content";
import { contarActivos } from "@/components/catalog/filters-panel";
import type { CatalogFilterOptions } from "@/lib/catalog";
import {
  buildCatalogHref,
  hayAlgunFiltro,
  type CatalogFilters,
} from "@/lib/catalog-params";

/// Tope para cerrar el panel si la navegacion nunca termina (red caida,
/// servidor sin responder). Sin esto, el panel se quedaria abierto para
/// siempre con una fila marcada y el usuario atrapado adentro.
const PANEL_SALIDA_MS = 2000;

/// Cambiar de categoria preserva el resto de los filtros. Antes esta funcion
/// solo conocia `categoria` y `q`: con precio, color y tecnica encima, elegir
/// una categoria habria borrado en silencio todo lo demas.

export function CategoryFilter({
  groups,
  filtros,
  opciones,
  total,
}: {
  /// Los MISMOS grupos que el menu del header, de la misma query
  /// (getMenuGroups). Que los dos lugares coincidan en contenido y orden es
  /// el punto de agrupar acá: si el catalogo armara su propio orden, tarde o
  /// temprano muestran cosas distintas.
  groups: MenuGroup[];
  filtros: CatalogFilters;
  opciones: CatalogFilterOptions;
  /// Cuantos productos da la combinacion actual. Va al boton que cierra el
  /// panel para que el cliente vea el efecto de lo que marco SIN cerrarlo:
  /// con multi-seleccion, cerrar en cada toque obliga a reabrir el panel
  /// tantas veces como colores quiera marcar.
  total: number;
}) {
  const activeSlug = filtros.categoria;
  const buildHref = (categorySlug?: string) =>
    buildCatalogHref(filtros, { categoria: categorySlug ?? null });

  const [open, setOpen] = useState(false);
  const categories = groups.flatMap((g) => g.categories);
  const activeCategory = categories.find((c) => c.slug === activeSlug);

  const agrupados = groups.filter((g) => g.name !== null);
  const sueltas = groups.find((g) => g.name === null)?.categories ?? [];

  // "Otras" arranca CERRADA salvo que la categoria filtrada este adentro: si
  // se quedara cerrada en ese caso, el cliente veria el catalogo filtrado sin
  // ninguna pill marcada y sin forma de saber por que.
  //
  // Se calcula en el useState inicial y no en un efecto: el efecto pintaria un
  // frame con el bloque cerrado antes de abrirlo.
  const activosDeFaceta = contarActivos(filtros);
  const activaEsSuelta = sueltas.some((c) => c.slug === activeSlug);
  const [otrasAbierto, setOtrasAbierto] = useState(activaEsSuelta);

  // Que categoria se toco y todavia no llego. El panel ya NO se cierra en el
  // toque: si se cerrara ahi, el control que el usuario acaba de tocar
  // desaparece de la pantalla justo cuando necesitaba devolverle una señal, y
  // queda mirando el catalogo viejo sin ningun cambio. "" es "Todas".
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  // El panel se cierra cuando la navegacion LLEGO, y eso se sabe mirando la
  // prop: activeSlug lo manda el server con los searchParams nuevos. Es estado
  // derivado, se ajusta en el render — no hace falta un efecto que escuche al
  // hijo ni pasar callbacks para arriba.
  if (pendingSlug !== null && (activeSlug ?? "") === pendingSlug) {
    setPendingSlug(null);
    setOpen(false);
  }

  // QUE categoria se muestra como activa. Mientras hay una navegacion en
  // curso manda la tocada, no la vigente: si mandara activeSlug, el violeta
  // se quedaria en la categoria que el usuario ACABA DE ABANDONAR, o sea que
  // la señal mas fuerte de la pantalla apuntaria al lugar equivocado.
  //
  // El cambio de color no parpadea aunque la navegacion sea rapida, porque no
  // es un indicador temporal: es el estado final adelantado. Cuando llega la
  // pagina, la fila ya esta donde tiene que estar. Lo unico que se anima con
  // retardo es la opacidad (clase "navegando"), que es la parte que sI
  // reverteria si la navegacion fallara.
  const slugMostrado = pendingSlug ?? activeSlug;

  // Salida de emergencia: si la navegacion nunca termina, el panel se cierra
  // igual. El setState va adentro del timeout (no sincronico en el efecto), y
  // el cleanup cancela el timer si la navegacion llega antes.
  useEffect(() => {
    if (pendingSlug === null) return;
    const id = setTimeout(() => {
      setPendingSlug(null);
      setOpen(false);
    }, PANEL_SALIDA_MS);
    return () => clearTimeout(id);
  }, [pendingSlug]);

  // Con el panel abierto, el scroll del body se bloquea.
  //
  // Este panel es `fixed inset-0` igual que el del hamburguesa y NO tenia el
  // bloqueo: el gesto movia la pagina de atras mientras el panel quedaba
  // quieto. Con los filtros adentro el panel pasa a ser mucho mas largo, asi
  // que el sintoma que antes casi no se notaba ahora seria el normal.
  //
  // El cleanup restaura el valor previo y no fuerza "": si el bloqueo no se
  // libera, la pagina queda congelada y la unica salida es recargar.
  useEffect(() => {
    if (!open) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, [open]);

  function cerrarPanel() {
    setOpen(false);
    setPendingSlug(null);
  }

  return (
    <>
      {/* Desktop: una COLUMNA por grupo, en el mismo orden que el menu del
          header. Apilados uno abajo del otro ocupaban toda la altura de la
          pantalla y desperdiciaban el ancho. */}
      <div className="hidden flex-col gap-5 md:flex">
        {/* "Todas" arriba y separada de las columnas, no adentro de una: no es
            una categoria sino la forma de LIMPIAR el filtro. Metida en el
            primer grupo se leeria como si perteneciera a el. */}
        <nav className="flex flex-wrap gap-2">
          <CategoryLink
            href={buildHref(undefined)}
            active={!slugMostrado}
            label="Todas"
            onNavigate={() => setPendingSlug("")}
          />
        </nav>

        {/* Mismo mecanismo que el menu del header: auto-fit + minmax para que
            las columnas se adapten al ancho real en vez de aplastarse. */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-x-6 gap-y-5">
          {agrupados.map((grupo) => (
            <div key={grupo.name}>
              <p className="mb-2 text-xs font-semibold tracking-wide text-foreground/40">
                {grupo.name}
              </p>
              <nav className="flex flex-wrap gap-2">
                {grupo.categories.map((category) => (
                  <CategoryLink
                    key={category.id}
                    href={buildHref(category.slug)}
                    active={category.slug === slugMostrado}
                    label={category.name}
                    onNavigate={() => setPendingSlug(category.slug)}
                  />
                ))}
              </nav>
            </div>
          ))}
        </div>

        {/* "Otras" COLAPSADA: es la bolsa de lo que no entro en ningun grupo
            y no tiene que competir visualmente con los grupos curados. Se
            abre sola cuando la categoria activa esta adentro — si no, el
            cliente no veria por que esta filtrando. */}
        {sueltas.length > 0 && (
          <div className="border-t border-foreground/10 pt-4">
            <button
              type="button"
              onClick={() => setOtrasAbierto((v) => !v)}
              aria-expanded={otrasAbierto}
              className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-foreground/40 transition-colors hover:text-foreground/70"
            >
              {GRUPO_SIN_AGRUPAR}
              <span className="text-foreground/30">({sueltas.length})</span>
              <ChevronIcon abierto={otrasAbierto} />
            </button>
            {otrasAbierto && (
              <nav className="mt-2 flex flex-wrap gap-2">
                {sueltas.map((category) => (
                  <CategoryLink
                    key={category.id}
                    href={buildHref(category.slug)}
                    active={category.slug === slugMostrado}
                    label={category.name}
                    onNavigate={() => setPendingSlug(category.slug)}
                  />
                ))}
              </nav>
            )}
          </div>
        )}
      </div>

      {/* Mobile: boton compacto que abre un panel, en vez de las 27 pills
          apiladas ocupando toda la pantalla antes de llegar a un producto. */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-full border border-foreground/15 px-4 py-2.5 text-sm font-medium text-foreground/80"
        >
          <FilterIcon />
          {activeCategory ? activeCategory.name : "Filtrar"}
          {activosDeFaceta > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-white">
              {activosDeFaceta}
            </span>
          )}
        </button>

        {open && (
          <div className="fixed inset-0 z-50 flex flex-col bg-background">
            <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
              <p className="text-sm font-medium text-foreground">Filtrar</p>
              {/* Nunca se deshabilita, ni siquiera mientras hay una
                  navegacion en curso: el usuario tiene que poder salir
                  siempre. */}
              <button
                type="button"
                onClick={cerrarPanel}
                aria-label="Cerrar filtro"
                className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* Igual que en desktop: "Todas" arriba, fuera de los grupos. */}
              <PanelLink
                href={buildHref(undefined)}
                active={!slugMostrado}
                label="Todas"
                onNavigate={() => setPendingSlug("")}
              />
              {/* En mobile los grupos van en una sola columna: es lo que
                  entra. */}
              {agrupados.map((grupo) => (
                <div key={grupo.name} className="mt-5">
                  <p className="mb-1 text-xs font-semibold tracking-wide text-foreground/40">
                    {grupo.name}
                  </p>
                  {grupo.categories.map((category) => (
                    <PanelLink
                      key={category.id}
                      href={buildHref(category.slug)}
                      active={category.slug === slugMostrado}
                      label={category.name}
                      onNavigate={() => setPendingSlug(category.slug)}
                    />
                  ))}
                </div>
              ))}

              {sueltas.length > 0 && (
                <div className="mt-5 border-t border-foreground/10 pt-4">
                  <button
                    type="button"
                    onClick={() => setOtrasAbierto((v) => !v)}
                    aria-expanded={otrasAbierto}
                    className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-foreground/40"
                  >
                    {GRUPO_SIN_AGRUPAR}
                    <span className="text-foreground/30">({sueltas.length})</span>
                    <ChevronIcon abierto={otrasAbierto} />
                  </button>
                  {otrasAbierto &&
                    sueltas.map((category) => (
                      <PanelLink
                        key={category.id}
                        href={buildHref(category.slug)}
                        active={category.slug === slugMostrado}
                        label={category.name}
                        onNavigate={() => setPendingSlug(category.slug)}
                      />
                    ))}
                </div>
              )}

              {/* Los filtros nuevos van DEBAJO de las categorías, dentro del
                  mismo panel: en mobile no hace falta un panel sobre otro, y
                  la categoría es la decisión más gruesa — primero se elige el
                  rubro y después se afina. */}
              <div className="mt-7 border-t border-foreground/10 pt-6">
                {/* Sin onNavegar: tocar un color NO cierra el panel. Con
                    multi-selección, cerrar en cada toque obliga a reabrirlo
                    tantas veces como chips quiera marcar. El contador del pie
                    le muestra el efecto sin salir. */}
                <FiltersContent filtros={filtros} opciones={opciones} />
              </div>

              {/* Aire al final: sin esto, el último chip queda pegado al pie
                  fijo y en un teléfono corto parece que la lista se cortó. */}
              <div className="h-6" />
            </div>

            {/* Pie fijo: el contador de resultados y la salida. Fuera del
                contenedor con overflow, así no se va con el scroll. */}
            <div className="flex items-center gap-3 border-t border-black/5 px-6 py-4">
              {hayAlgunFiltro(filtros) && (
                <Link
                  href={buildCatalogHref(filtros, {
                    q: null,
                    categoria: null,
                    precioMin: null,
                    precioMax: null,
                    colores: [],
                    tecnicas: [],
                  })}
                  scroll={false}
                  onClick={cerrarPanel}
                  className="shrink-0 text-sm font-medium text-foreground/55 underline underline-offset-2"
                >
                  Borrar
                </Link>
              )}
              <button
                type="button"
                onClick={cerrarPanel}
                className="flex-1 rounded-full bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
              >
                Ver {total} {total === 1 ? "producto" : "productos"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function CategoryLink({
  href,
  active,
  label,
  onNavigate,
}: {
  href: string;
  active: boolean;
  label: string;
  onNavigate: () => void;
}) {
  return (
    // El Link se queda solo con lo estructural: el aspecto vive en el hijo.
    <Link href={href} onClick={onNavigate} className="shrink-0 rounded-full">
      <CategoryChip active={active} label={label} />
    </Link>
  );
}

function PanelLink({
  href,
  active,
  label,
  onNavigate,
}: {
  href: string;
  active: boolean;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link href={href} onClick={onNavigate} className="block">
      <PanelRow active={active} label={label} />
    </Link>
  );
}

function ChevronIcon({ abierto }: { abierto: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={"h-3.5 w-3.5 transition-transform " + (abierto ? "rotate-180" : "")}
    >
      <path
        d="M6 8l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <circle cx="9" cy="7" r="2.2" fill="var(--background)" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="16" cy="17" r="2.2" fill="var(--background)" />
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

"use client";

import { useLinkStatus } from "next/link";

/// Contenido estilado de los links de navegacion del catalogo.
///
/// Por que existe este archivo: el aspecto de estos controles (el fondo del
/// chip, el circulo del numero de pagina) vivia sobre el propio <Link>. Se
/// muda a un hijo para poder reaccionar al estado de la navegacion desde
/// adentro — useLinkStatus solo puede llamarse en un DESCENDIENTE del Link, y
/// un hijo no puede estilar a su padre. Con el aspecto aca abajo, el control
/// se estila a si mismo.
///
/// Que cubre esto y que no: /catalogo ya tiene su loading.tsx, asi que el
/// esqueleto aparece al cambiar de categoria o de pagina. Lo que quedaba
/// descubierto es el instante ANTERIOR, entre el toque y el esqueleto, donde
/// la pantalla vieja se queda quieta. En mobile eso puede durar segundos y el
/// usuario no sabe si el toque registro. Esta marca cubre ese hueco y nada
/// mas.
///
/// Por que NO se pone prefetch={false} en los Links: la doc de useLinkStatus
/// dice que el hook "es mas util" con el prefetch apagado, y que si la ruta ya
/// esta prefetcheada el pending se saltea. Pero apagarlo haria lento SIEMPRE
/// lo que hoy es rapido. El hueco que estamos tapando es justamente cuando el
/// prefetch no llego a completarse; dejandolo prendido, la marca aparece solo
/// en ese caso.

/// Devuelve la clase de "navegando" cuando este link es el que se esta
/// cargando. La clase (ver globals.css) atenua con 120ms de retardo, asi las
/// navegaciones rapidas no parpadean.
function useNavegandoClass(): string {
  const { pending } = useLinkStatus();
  return pending ? " navegando" : "";
}

export function CategoryChip({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  const navegando = useNavegandoClass();

  return (
    <span
      className={
        "block rounded-full px-4 py-2 text-sm font-medium transition-colors " +
        (active
          ? "bg-primary text-white"
          : "bg-foreground/5 text-foreground/70 hover:bg-foreground/10") +
        navegando
      }
    >
      {label}
    </span>
  );
}

export function PanelRow({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  const navegando = useNavegandoClass();

  return (
    <span
      className={
        "block rounded-lg px-3 py-3 text-base transition-colors " +
        (active
          ? "font-medium text-primary"
          : "text-foreground/80 hover:text-primary-light") +
        navegando
      }
    >
      {label}
    </span>
  );
}

export function PageNumber({
  page,
  active,
}: {
  page: number;
  active: boolean;
}) {
  const navegando = useNavegandoClass();

  return (
    <span
      className={
        "flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition-colors " +
        (active
          ? "bg-primary text-white"
          : "text-foreground/70 hover:bg-foreground/5") +
        navegando
      }
    >
      {page}
    </span>
  );
}

export function PageNavLabel({ label }: { label: string }) {
  const navegando = useNavegandoClass();

  return (
    <span
      className={
        "block px-3 text-sm font-medium text-foreground/70 transition-colors hover:text-primary" +
        navegando
      }
    >
      {label}
    </span>
  );
}

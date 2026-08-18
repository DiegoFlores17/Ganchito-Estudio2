/// Contenido estilado de los links de navegacion del catalogo.
///
/// Por que existe este archivo: el aspecto de estos controles (el fondo del
/// chip, el circulo del numero de pagina) vivia sobre el propio <Link>. Se
/// muda a un hijo para poder reaccionar al estado de la navegacion desde
/// adentro — useLinkStatus solo puede llamarse en un DESCENDIENTE del Link, y
/// un hijo no puede estilar a su padre. Con el aspecto aca abajo, el control
/// se estila a si mismo.
///
/// El <Link> queda solo con lo estructural (shrink-0, block); todo lo visual
/// esta en estos spans.

export function CategoryChip({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <span
      className={
        "block rounded-full px-4 py-2 text-sm font-medium transition-colors " +
        (active
          ? "bg-primary text-white"
          : "bg-foreground/5 text-foreground/70 hover:bg-foreground/10")
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
  return (
    <span
      className={
        "block rounded-lg px-3 py-3 text-base transition-colors " +
        (active
          ? "font-medium text-primary"
          : "text-foreground/80 hover:text-primary-light")
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
  return (
    <span
      className={
        "flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition-colors " +
        (active
          ? "bg-primary text-white"
          : "text-foreground/70 hover:bg-foreground/5")
      }
    >
      {page}
    </span>
  );
}

export function PageNavLabel({ label }: { label: string }) {
  return (
    <span className="block px-3 text-sm font-medium text-foreground/70 transition-colors hover:text-primary">
      {label}
    </span>
  );
}

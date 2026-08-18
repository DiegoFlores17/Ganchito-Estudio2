import Link from "next/link";

/// Pantalla de "no existe" de la tienda publica.
///
/// Cubre las llamadas a notFound() dentro del segmento (store) — hoy la de
/// /producto/[id] cuando el id no corresponde a ningun producto. Se renderiza
/// dentro de (store)/layout.tsx, asi que conserva header y footer y el
/// cliente puede seguir navegando en vez de quedar en una pagina muerta.
///
/// OJO: esto NO cubre las URLs que no matchean ninguna ruta (por ejemplo
/// /cualquier-cosa). Segun la doc de Next, esas las atiende el not-found.tsx
/// de la raiz de app/, que todavia no existe: ahi sigue apareciendo el 404
/// generico. Ver HANDOFF.
export default function StoreNotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-6 px-6 py-28 sm:items-center sm:text-center">
      <p className="text-sm font-medium text-primary">Error 404</p>

      <h1 className="text-4xl font-black tracking-tight text-foreground">
        No encontramos lo que buscabas
      </h1>

      <p className="text-foreground/70">
        Puede que el producto ya no esté disponible o que el link esté mal.
        Probá desde el catálogo: seguro encontrás algo que te sirva.
      </p>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/catalogo"
          className="rounded-full bg-accent px-7 py-3 text-sm font-medium text-primary-dark transition-colors hover:bg-accent-hover"
        >
          Ver el catálogo
        </Link>
        <Link
          href="/"
          className="rounded-full border border-foreground/15 px-7 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}

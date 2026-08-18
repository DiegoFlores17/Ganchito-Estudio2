import Link from "next/link";

/// 404 de las URLs que no matchean NINGUNA ruta de la app.
///
/// Es distinto de (store)/not-found.tsx: aquel atiende las llamadas a
/// notFound() dentro de la tienda y se renderiza con header y footer. Este
/// atiende cualquier URL suelta de TODA la app, incluidas las del panel.
///
/// Por eso NO repite el header ni el footer de la tienda, aunque tecnicamente
/// podria: ponerle la navegacion de la tienda a alguien que tipeo mal una URL
/// de /admin seria contexto equivocado, y el Header ademas arrastra
/// CartIndicator y MobileNav, dos client components — JS del carrito en una
/// pantalla de error. En su lugar van los links de escape explicitos, que son
/// la accion que de verdad queremos que tome el que cae aca.
///
/// A diferencia de global-error.tsx, este SI se renderiza dentro del layout
/// raiz, asi que tiene disponibles globals.css y Montserrat: se puede usar
/// Tailwind y los tokens de la paleta con normalidad.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-24">
      <div className="flex max-w-xl flex-col items-start gap-6 sm:items-center sm:text-center">
        <p className="text-sm font-medium text-primary">Ganchito Estudio</p>

        <h1 className="text-4xl font-black tracking-tight text-foreground">
          Esta página no existe
        </h1>

        <p className="text-foreground/70">
          El link puede estar mal escrito o la página puede haberse mudado.
          Desde el catálogo llegás a todo.
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
    </div>
  );
}

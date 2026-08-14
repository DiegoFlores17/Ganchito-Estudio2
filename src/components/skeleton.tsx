/// Bloque de carga reutilizable.
///
/// El tinte es violeta de marca a muy baja opacidad: se lee como un gris
/// neutro pero pertenece a la paleta, en vez del gris del navegador. La
/// animacion es el `animate-pulse` de Tailwind — deliberadamente sobria, sin
/// shimmer ni barridos, para no llenar la pantalla de movimiento mientras
/// carga media grilla de productos.
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-primary/[0.07] ${className}`}
    />
  );
}

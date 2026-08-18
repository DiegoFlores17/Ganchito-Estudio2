"use client";

/// Ultimo recurso: solo aparece si falla el layout raiz, es decir cuando ni
/// siquiera llegaron a montarse los error.tsx de la tienda o del panel.
///
/// Reemplaza al layout raiz por completo, asi que tiene que traer sus propias
/// etiquetas <html> y <body>. Por eso mismo NO usa Tailwind ni las variables
/// de color del tema: si lo que se rompio fue el layout, no hay garantia de
/// que la hoja de estilos haya cargado. Los colores de marca van escritos a
/// mano y los estilos son inline, para que esta pantalla no dependa de nada.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          backgroundColor: "#440670",
          color: "#ffffff",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "32rem" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "#FFF835",
            }}
          >
            Ganchito Estudio
          </p>

          <h1
            style={{
              margin: "0.5rem 0 0",
              fontSize: "2.25rem",
              fontWeight: 900,
              letterSpacing: "-0.02em",
            }}
          >
            Se nos rompio algo
          </h1>

          <p
            style={{
              margin: "1.5rem 0 0",
              lineHeight: 1.6,
              color: "rgba(255, 255, 255, 0.75)",
            }}
          >
            No pudimos cargar el sitio. Proba de nuevo en un momento.
          </p>

          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: "2rem",
              padding: "0.875rem 1.75rem",
              borderRadius: "9999px",
              border: "none",
              backgroundColor: "#FFF835",
              color: "#440670",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>

          {error.digest && (
            <p
              style={{
                margin: "2rem 0 0",
                fontSize: "0.75rem",
                color: "rgba(255, 255, 255, 0.4)",
              }}
            >
              Codigo de referencia: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}

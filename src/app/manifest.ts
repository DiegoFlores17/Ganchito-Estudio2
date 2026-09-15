import type { MetadataRoute } from "next";

/// Manifest para "agregar a pantalla de inicio" en Android y Chrome.
///
/// iOS no lo usa para el ícono —toma `apple-icon.png`, que Next expone por
/// convención desde src/app/— pero sí lee `name` para el nombre del atajo.
///
/// Los íconos viven en public/ y no en src/app/ a propósito: los de src/app/
/// pasan por el pipeline de metadata de Next, que les agrega un hash al nombre
/// para invalidar caché. Ese hash cambia entre builds, así que una ruta fija
/// dentro del manifest quedaría apuntando a un archivo que ya no existe.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ganchito Estudio",
    short_name: "Ganchito",
    description:
      "Merchandising corporativo personalizado con el logo de tu empresa.",
    start_url: "/",
    display: "standalone",
    // El ícono va sin fondo (el clip transparente, como la marca lo usa), así
    // que estos colores son solo los del entorno del atajo: la pantalla de
    // arranque y la barra de estado. Violeta, que es el color protagonista de
    // la identidad y sobre el que el amarillo del clip se lee bien.
    background_color: "#440670",
    theme_color: "#440670",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // NO se declara `maskable`: esa marca le dice a Android que puede
      // recortar el ícono con la forma del launcher rellenando el resto, y con
      // un PNG transparente el relleno queda a criterio del sistema. Sin la
      // marca, Android dibuja el clip sobre su propio fondo y se respeta el
      // ícono tal como es.
    ],
  };
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp tiene binarios nativos (libvips): si el bundler intenta
  // empaquetarlo, el binario se rompe. Se deja fuera del bundle y se carga
  // como dependencia normal de Node en el servidor.
  serverExternalPackages: ["sharp"],
  images: {
    // Hosts reales de las imagenes de producto sincronizadas desde Zecat.
    remotePatterns: [
      { protocol: "https", hostname: "images-cdn.zecat.com" },
      { protocol: "https", hostname: "d1yq3fbd6icaus.cloudfront.net" },
      // Fotos de producto manual, subidas a Vercel Blob (ver src/lib/storage.ts).
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      // CDO Promocionales sirve TODO desde CloudFront: fotos de producto, de
      // color y los iconos de atributos.
      //
      // Va con comodin y no con los hosts sueltos porque el id de la
      // distribucion cambia entre entornos y no hay forma de preverlo: pruebas
      // usa d1ok1ldurjeiif y produccion d2jygl58194cng. Listarlos a mano
      // significa que el catalogo se rompe el dia que agreguen una
      // distribucion nueva, y el sintoma es una pagina caida, no una imagen
      // faltante.
      //
      // El costo de abrirlo: nuestro optimizador de imagenes acepta cualquier
      // URL de cloudfront.net. Es tolerable porque las URLs solo entran por
      // los conectores y por Blob, nunca por input de usuario. Si algun dia se
      // quiere ajustar, se reemplaza por los hosts concretos.
      { protocol: "https", hostname: "*.cloudfront.net" },
      // CDO Promocionales sirve TODO desde este CloudFront: fotos de producto,
      // de color y los iconos de atributos (627 + 70 en el entorno de pruebas).
      //
      // OJO: este host es el del entorno de PRUEBAS. Al apuntar a produccion
      // hay que confirmar si es el mismo — el host de assets de pruebas
      // (assets.cdo.dev.yellowspot.com.ar, el de los missing.png que filtramos)
      // claramente no lo es, asi que no se puede dar por hecho.
      { protocol: "https", hostname: "d1ok1ldurjeiif.cloudfront.net" },
    ],
  },
};

export default nextConfig;

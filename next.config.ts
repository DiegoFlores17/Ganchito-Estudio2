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
    ],
  },
};

export default nextConfig;

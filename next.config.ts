import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Hosts reales de las imagenes de producto sincronizadas desde Zecat.
    remotePatterns: [
      { protocol: "https", hostname: "images-cdn.zecat.com" },
      { protocol: "https", hostname: "d1yq3fbd6icaus.cloudfront.net" },
    ],
  },
};

export default nextConfig;

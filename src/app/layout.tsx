import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "900"],
});

export const metadata: Metadata = {
  // El dominio propio, para que las og:image y URLs absolutas no salgan con
  // el .vercel.app. La carga el deploy (NEXT_PUBLIC_SITE_URL); sin ella
  // Next cae al host del request, que en produccion es el dominio que sea
  // que se este visitando.
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
  title: "Ganchito Estudio",
  description:
    "Merchandising corporativo personalizado con el logo de tu empresa.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}

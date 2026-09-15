import type { ReactNode } from "react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { WhatsappBubble } from "@/components/layout/whatsapp-bubble";
import { getSiteConfig, whatsappUrlConMensaje } from "@/lib/site-config";

export default async function StoreLayout({ children }: { children: ReactNode }) {
  const config = await getSiteConfig();
  // Si no hay numero cargado no se renderiza nada: un boton de WhatsApp que
  // lleva a un link roto es peor que no tener boton.
  const whatsapp = whatsappUrlConMensaje(
    config.whatsappNumber,
    config.whatsappMessage
  );

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      {/* Solo en la tienda: /admin tiene su propio layout y no la incluye. */}
      {whatsapp && <WhatsappBubble href={whatsapp} />}
    </div>
  );
}

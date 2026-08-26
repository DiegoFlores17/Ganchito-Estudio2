import { requireSuperAdmin } from "@/lib/admin-auth";
import { getPricingConfig } from "@/lib/pricing";
import { formatWhatsappLabel, getSiteConfig } from "@/lib/site-config";
import { PricingConfigForm } from "@/components/admin/pricing-config-form";
import { SiteConfigForm } from "@/components/admin/site-config-form";

export default async function ConfiguracionPage() {
  await requireSuperAdmin();
  const [config, site] = await Promise.all([getPricingConfig(), getSiteConfig()]);

  return (
    <div className="flex flex-col gap-12">
      <div>
        <h1 className="text-2xl font-medium text-foreground">Configuración</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Precios y datos de contacto de la tienda.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-medium text-foreground">Precios</h2>
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">
          Margen, IVA y cotización del dólar. Afecta el precio de todo el
          catálogo al instante, sin re-sincronizar.
        </p>
        <div className="mt-4">
          <PricingConfigForm
            defaultMarginPercent={Number(config.defaultMarginPercent)}
            vatPercent={Number(config.vatRate) * 100}
            usdRate={Number(config.usdRate)}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium text-foreground">Contacto</h2>
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">
          Se muestran en el footer de todas las páginas y en el botón
          &ldquo;Contacto&rdquo; de la portada.
        </p>
        <div className="mt-4">
          <SiteConfigForm
            contactEmail={site.contactEmail ?? ""}
            whatsappNumber={site.whatsappNumber ?? ""}
            whatsappLabel={formatWhatsappLabel(site.whatsappNumber) ?? ""}
            instagramHandle={site.instagramHandle ?? ""}
            address={site.address ?? ""}
            openingHours={site.openingHours ?? ""}
          />
        </div>
      </section>
    </div>
  );
}

import { requireSuperAdmin } from "@/lib/admin-auth";
import { formatDateTime } from "@/lib/format";
import { getPricingConfig } from "@/lib/pricing";
import { FUENTE_OFICIAL } from "@/lib/usd-rate";
import { formatWhatsappLabel, getSiteConfig } from "@/lib/site-config";
import { PricingConfigForm } from "@/components/admin/pricing-config-form";
import { SiteConfigForm } from "@/components/admin/site-config-form";
import { RefrescarTiendaButton } from "@/components/admin/refrescar-tienda-button";

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
            usdRateMode={config.usdRateMode}
            usdRateSource={config.usdRateSource}
            // Se resuelve acá y no en el formulario: la constante vive en
            // lib/usd-rate, que importa prisma, y arrastrarla a un componente
            // de cliente meteria el cliente de la base en el bundle.
            usdRateEsOficial={config.usdRateSource === FUENTE_OFICIAL}
            // Las fechas se formatean ACÁ y no en el cliente: si cada lado usa
            // su propia zona horaria, el texto cambia al hidratar.
            usdRateUpdatedAt={formatearFecha(config.usdRateUpdatedAt)}
            usdRateOfficial={
              config.usdRateOfficial === null
                ? null
                : Number(config.usdRateOfficial)
            }
            usdRateOfficialAt={formatearFecha(config.usdRateOfficialAt)}
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
            whatsappMessage={site.whatsappMessage ?? ""}
            instagramHandle={site.instagramHandle ?? ""}
            address={site.address ?? ""}
            openingHours={site.openingHours ?? ""}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium text-foreground">Caché de la tienda</h2>
        <p className="mt-1 max-w-2xl text-sm text-foreground/60">
          La tienda guarda en caché el catálogo, el menú, las fichas, los
          precios y el contacto, y se actualiza sola cuando guardás algo desde
          este panel o corre un sync automático. Usá este botón después de un
          sync hecho por consola, una migración o una edición manual en la
          base, que no pueden avisarle a la tienda. Si no lo usás, se pone al
          día sola en unas horas.
        </p>
        <div className="mt-4">
          <RefrescarTiendaButton />
        </div>
      </section>
    </div>
  );
}

/// Se hace en el servidor para que el texto sea el mismo antes y después de
/// hidratar. Mismo formato y zona que el resto del panel (lib/format).
function formatearFecha(fecha: Date | null): string | null {
  return fecha ? formatDateTime(fecha) : null;
}

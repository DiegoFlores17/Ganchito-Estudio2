import { requireSuperAdmin } from "@/lib/admin-auth";
import { getPricingConfig } from "@/lib/pricing";
import { PricingConfigForm } from "@/components/admin/pricing-config-form";

export default async function ConfiguracionPage() {
  await requireSuperAdmin();
  const config = await getPricingConfig();

  return (
    <div>
      <h1 className="text-2xl font-medium text-foreground">Configuración</h1>
      <p className="mt-1 text-sm text-foreground/60">
        Margen, IVA y cotización del dólar. Afecta el precio de todo el
        catálogo al instante, sin re-sincronizar.
      </p>

      <div className="mt-6">
        <PricingConfigForm
          defaultMarginPercent={Number(config.defaultMarginPercent)}
          vatPercent={Number(config.vatRate) * 100}
          usdRate={Number(config.usdRate)}
        />
      </div>
    </div>
  );
}

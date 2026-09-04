import { ProductOrigin } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import { SyncProviderCard } from "@/components/admin/sync-provider-card";
import { SyncRunHistory } from "@/components/admin/sync-run-history";

// Tope explicito de las invocaciones de este segmento — cubre a las server
// actions de la sincronizacion (un archivo "use server" no puede exportar
// config, va aca). Cada batch procesa 10 productos (~16s esperados): 120s
// deja 7x de margen.
export const maxDuration = 120;

export default async function ProveedoresPage() {
  // requireAdmin y NO requireSuperAdmin, por principio: sincronizar aplica
  // la verdad del proveedor y es reversible corriendo de nuevo — operacion
  // del dia a dia, no decision de negocio. Mismo criterio que Categorias.
  await requireAdmin();

  const runs = await prisma.syncRun.findMany({
    where: { provider: ProductOrigin.ZECAT },
    orderBy: { startedAt: "desc" },
    take: 5,
  });

  // Nombres de los productos ausentes, para que el resumen diga algo util
  // ("Mate Zaino") y no un id pelado.
  const missingIds = [
    ...new Set(runs.flatMap((r) => r.missingExternalIds as string[])),
  ];
  const missingProducts = missingIds.length
    ? await prisma.product.findMany({
        where: { zecatId: { in: missingIds } },
        select: { zecatId: true, name: true, active: true },
      })
    : [];
  const missingNameById = new Map(
    missingProducts.map((p) => [p.zecatId!, { name: p.name, active: p.active }])
  );

  return (
    <div>
      <h1 className="text-2xl font-medium text-foreground">Proveedores</h1>
      <p className="mt-1 max-w-2xl text-sm text-foreground/60">
        Sincronizá el catálogo con cada proveedor. Los productos se crean o
        actualizan con los datos y costos de su API; los precios de venta se
        recalculan solos.
      </p>

      <div className="mt-8 max-w-2xl">
        <SyncProviderCard
          provider={ProductOrigin.ZECAT}
          nombre="Zecat"
          descripcion="API oficial · ~550 productos · 5-10 minutos con la pestaña abierta"
        />
      </div>

      <div className="mt-10 max-w-2xl">
        <h2 className="text-sm font-medium text-foreground/60">
          Últimas corridas
        </h2>
        <SyncRunHistory
          runs={runs.map((r) => ({
            id: r.id,
            status: r.status,
            startedBy: r.startedBy,
            startedAt: r.startedAt.toLocaleString("es-AR"),
            finishedAt: r.finishedAt?.toLocaleString("es-AR") ?? null,
            created: r.created,
            updated: r.updated,
            paused: r.paused,
            failed: r.failed,
            usdWarnings: r.usdWarnings,
            missing: (r.missingExternalIds as string[]).map((id) => ({
              id,
              nombre: missingNameById.get(id)?.name ?? id,
              activo: missingNameById.get(id)?.active ?? false,
            })),
            errors: r.errors as Array<{ externalId: string; message: string }>,
          }))}
        />
      </div>
    </div>
  );
}

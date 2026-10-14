import { AdminRole, ProductOrigin, SyncRunStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import { alertConfigStatus } from "@/lib/email";
import { formatDateTime, formatHace } from "@/lib/format";
import {
  ausentesPendientes,
  estadoDelProveedor,
  leerSummary,
  origenDeCorrida,
  type EstadoProveedor,
} from "@/lib/sync-run";
import { SyncAlertStatus } from "@/components/admin/sync-alert-status";
import { SyncProviderCard } from "@/components/admin/sync-provider-card";
import { SyncRunHistory } from "@/components/admin/sync-run-history";

// Tope explicito de las invocaciones de este segmento — cubre a las server
// actions de la sincronizacion (un archivo "use server" no puede exportar
// config, va aca). Cada batch procesa 10 productos (~16s esperados): 120s
// deja 7x de margen. "Pausar estos N" confirma de a 8 con 15 s de timeout:
// el peor caso de ~30 ausentes son ~60 s.
export const maxDuration = 120;

const ESTILO_ESTADO: Record<EstadoProveedor, { caja: string; titulo: string }> = {
  OK: { caja: "border-green-200 bg-green-50", titulo: "text-green-800" },
  BLOQUEADO: { caja: "border-amber-200 bg-amber-50", titulo: "text-amber-800" },
  DESACTUALIZADO: { caja: "border-amber-200 bg-amber-50", titulo: "text-amber-800" },
  A_REVISAR: { caja: "border-amber-200 bg-amber-50", titulo: "text-amber-800" },
  FALLANDO: { caja: "border-red-200 bg-red-50", titulo: "text-red-700" },
};

export default async function ProveedoresPage() {
  // requireAdmin y NO requireSuperAdmin, por principio: sincronizar aplica
  // la verdad del proveedor y es reversible corriendo de nuevo — operacion
  // del dia a dia, no decision de negocio. Mismo criterio que Categorias.
  const admin = await requireAdmin();
  const alertas = alertConfigStatus();
  const ahora = new Date();

  const [recientes, estado] = await Promise.all([
    prisma.syncRun.findMany({
      where: { provider: ProductOrigin.ZECAT },
      orderBy: { startedAt: "desc" },
      take: 5,
    }),
    estadoDelProveedor(ProductOrigin.ZECAT, ahora),
  ]);
  // La ultima corrida COMPLETA siempre se muestra, aunque haya quedado
  // fuera de las 5 mas recientes (varias fallidas despues): es donde vive
  // el boton "Pausar estos N" y adonde apunta el link del mail del umbral.
  const ultimaCompletaFila =
    estado.ultimaCompleta && !recientes.some((r) => r.id === estado.ultimaCompleta!.id)
      ? await prisma.syncRun.findUnique({ where: { id: estado.ultimaCompleta.id } })
      : null;
  const runs = ultimaCompletaFila ? [...recientes, ultimaCompletaFila] : recientes;

  // El conteo de la card sale de la ultima corrida que llego a saberlo (la
  // API lo reporta en la pagina 1), no de un numero hardcodeado que
  // envejece: el catalogo de Zecat crecio de 545 a 638 en cuatro dias.
  const ultimoTotal = runs.find((r) => r.totalRemote !== null)?.totalRemote;

  // El boton "Pausar estos N" va solo en la ULTIMA corrida completa, y solo
  // si freno el umbral y quedan ausentes sin resolver.
  const ultimaCompletaId = estado.ultimaCompleta?.id;
  const pendientesPorCorrida = new Map<string, number>();
  for (const r of runs) {
    if (r.id === ultimaCompletaId && r.status === SyncRunStatus.DONE && r.autoPauseSkipped) {
      pendientesPorCorrida.set(r.id, (await ausentesPendientes(r)).length);
    }
  }

  const ultimaFila = runs.find((r) => r.id === ultimaCompletaId);
  const ultimaSummary = ultimaFila ? leerSummary(ultimaFila) : null;
  // Solo los que siguen activos: un "a revisar" que ya se pauso esta resuelto.
  const aRevisar = estado.aRevisar;

  const estilo = ESTILO_ESTADO[estado.estado];
  const ultima = estado.ultimaCompleta;

  return (
    <div>
      <h1 className="text-2xl font-medium text-foreground">Proveedores</h1>
      <p className="mt-1 max-w-2xl text-sm text-foreground/60">
        Sincronizá el catálogo con cada proveedor. Los productos se crean o
        actualizan con los datos y costos de su API; los precios de venta se
        recalculan solos.
      </p>

      {/* Estado del catalogo: sale de la ultima corrida COMPLETA, no de la
          ultima iniciada — una corrida en curso o fallida no actualizo nada. */}
      <div className={`mt-8 max-w-2xl rounded-xl border p-5 text-sm ${estilo.caja}`}>
        <p className={`font-medium ${estilo.titulo}`}>
          {ultima
            ? `Catálogo de Zecat actualizado ${formatHace(ultima.finishedAt, ahora)}`
            : "Catálogo de Zecat: todavía no hay ninguna sincronización completa"}
          {ultima && (
            <span className="font-normal text-foreground/60">
              {" "}
              ({origenDeCorrida(ultima.startedBy)}, {formatDateTime(ultima.finishedAt)})
            </span>
          )}
        </p>
        {estado.estado === "OK" && (
          <p className="mt-1 text-foreground/70">Al día. No hay nada pendiente.</p>
        )}
        {estado.estado === "FALLANDO" && estado.ultimaFallida && (
          <p className="mt-1 text-foreground/80">
            La última sincronización ({formatDateTime(estado.ultimaFallida.startedAt)}) falló.
            El catálogo quedó como en la última completa. El motivo está en el
            historial de abajo; probá sincronizar de nuevo.
          </p>
        )}
        {estado.estado === "BLOQUEADO" && (
          <p className="mt-1 text-foreground/80">
            La última sincronización frenó el pausado: {estado.pendientes.length}{" "}
            productos dejaron de venir de golpe y siguen a la venta. Revisalos y
            usá «Pausar estos {estado.pendientes.length}» en esa corrida, abajo.
          </p>
        )}
        {estado.estado === "A_REVISAR" && (
          <p className="mt-1 text-foreground/80">
            {aRevisar.length} productos a revisar: Zecat los publica pero no los
            lista, así que siguen a la venta sin sincronizarse. El detalle está
            abajo.
          </p>
        )}
        {estado.estado === "DESACTUALIZADO" && (
          <p className="mt-1 text-foreground/80">
            {ultima
              ? "Pasaron más de 26 horas sin una sincronización completa: precios y stock pueden estar viejos. Sincronizá ahora."
              : "Sincronizá para cargar el catálogo."}
          </p>
        )}
      </div>

      {aRevisar.length > 0 && ultimaSummary && (
        <div className="mt-4 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm">
          <p className="font-medium text-amber-800">
            {aRevisar.length} productos a revisar
          </p>
          <p className="mt-1 text-foreground/70">
            No vinieron en el listado de Zecat, pero su ficha sigue publicada y
            con variantes, así que no se pausaron. Puede ser un producto que
            Zecat sacó del listado a propósito o un error de su lado: buscalos
            en la web de Zecat.
          </p>
          <ul className="mt-2 text-xs text-foreground/70">
            {aRevisar.map((id) => (
              <li key={id}>
                [{id}] {ultimaSummary.nombres[id] ?? id}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 max-w-2xl">
        <SyncProviderCard
          provider={ProductOrigin.ZECAT}
          nombre="Zecat"
          descripcion={`API oficial${ultimoTotal ? ` · ${ultimoTotal} productos` : ""} · 5-10 minutos con la pestaña abierta`}
        />
      </div>

      <div className="mt-4 max-w-2xl">
        <SyncAlertStatus
          destinatarios={alertas.destinatarios}
          invalidos={alertas.invalidos}
          tieneApiKey={alertas.tieneApiKey}
          puedeProbar={admin.role === AdminRole.SUPER_ADMIN}
        />
      </div>

      <div className="mt-10 max-w-2xl">
        <h2 className="text-sm font-medium text-foreground/60">
          Últimas corridas
        </h2>
        <SyncRunHistory
          runs={runs.map((r) => {
            const summary = leerSummary(r);
            const alCierre = new Set(summary?.autoPausados ?? []);
            return {
              id: r.id,
              status: r.status,
              origen: origenDeCorrida(r.startedBy),
              startedAt: formatDateTime(r.startedAt),
              finishedAt: r.finishedAt ? formatDateTime(r.finishedAt) : null,
              summary,
              // Lo pausado despues del cierre ("Pausar estos N"): lo que
              // autoPausedExternalIds tiene de mas sobre el resumen fijo.
              // En una corrida vieja (sin resumen) todo lo registrado vino del
              // boton: antes de B el auto-pausado no dejaba resumen.
              pausadosDespues: (r.autoPausedExternalIds as string[]).filter(
                (id) => !alCierre.has(id)
              ),
              pendientesDePausar: pendientesPorCorrida.get(r.id) ?? 0,
              errors: r.errors as Array<{ externalId: string; message: string }>,
            };
          })}
        />
      </div>
    </div>
  );
}

import type { SyncRunSummary } from "@/lib/sync-run";

/// Lo que quedo de una corrida, leido de su resumen fijo (SyncRun.summary).
/// Lo usan la card del resultado y la fila del historial: un solo
/// componente sobre una sola fuente, para que nunca muestren cifras
/// distintas de la misma corrida.
///
/// Sin hooks a proposito: se renderiza dentro de componentes de cliente
/// (card e historial) y no necesita estado propio.
export function SyncRunSummaryLine({
  summary,
  pausadosDespues = 0,
}: {
  summary: SyncRunSummary;
  /// Pausados DESPUES del cierre con "Pausar estos N" (no estan en el
  /// resumen, que es fijo: salen de autoPausedExternalIds).
  pausadosDespues?: number;
}) {
  const s = summary;
  return (
    <>
      <p className="mt-1 text-xs text-foreground/60">
        {s.creados} creados · {s.actualizados} actualizados
        {s.pausadosSinPrecio > 0 && (
          <> · {s.pausadosSinPrecio} pausados por falta de precio del proveedor</>
        )}
        {s.fallidos > 0 && <> · {s.fallidos} fallidos</>}
        {(s.variantesDesactivadas > 0 || s.productosSinVariantes > 0) && (
          <>
            {" "}
            · {s.variantesDesactivadas} variantes desactivadas ·{" "}
            {s.productosSinVariantes} productos sin variantes
          </>
        )}
      </p>
      <p className="text-xs text-foreground/60">
        {s.autoPausados.length > 0 && (
          <span className="text-primary-dark">
            {s.autoPausados.length} pausados automáticamente (el proveedor
            confirmó la baja) ·{" "}
          </span>
        )}
        {s.umbralFrenado && (
          <span className="font-medium text-primary-dark">
            ⚠ {s.ausentes.length} ausentes de golpe, más que el límite de{" "}
            {s.umbral}: no se pausó ninguno ·{" "}
          </span>
        )}
        {pausadosDespues > 0 && (
          <span className="text-primary-dark">
            {pausadosDespues} pausados después desde el panel ·{" "}
          </span>
        )}
        {s.aRevisar.length > 0 && (
          <span className="font-medium text-primary-dark">
            {s.aRevisar.length} a revisar (siguen publicados pero no vinieron en
            el listado) ·{" "}
          </span>
        )}
        {s.noVerificados.length > 0 && (
          <span className="text-primary-dark">
            {s.noVerificados.length} no se pudieron verificar (se reintenta en
            la próxima corrida) ·{" "}
          </span>
        )}
        {s.yaPausadosFueraDeApi.length > 0 && (
          <>{s.yaPausadosFueraDeApi.length} ya pausados siguen fuera de la API</>
        )}
      </p>
    </>
  );
}

/// Las listas con nombre de una corrida, para el detalle expandido.
export function SyncRunSummaryDetail({
  summary,
  pausadosDespues,
}: {
  summary: SyncRunSummary;
  pausadosDespues: string[];
}) {
  const s = summary;
  const nombre = (id: string) => s.nombres[id] ?? id;
  const autoPausados = new Set(s.autoPausados);
  const despues = new Set(pausadosDespues);
  const aRevisar = new Set(s.aRevisar);
  const noVerificados = new Set(s.noVerificados);

  const estadoAusente = (id: string) =>
    autoPausados.has(id)
      ? "pausado automáticamente"
      : despues.has(id)
        ? "pausado después desde el panel"
        : aRevisar.has(id)
          ? "A REVISAR: sigue publicado en el proveedor"
          : noVerificados.has(id)
            ? "no se pudo verificar, no se pausó"
            : s.umbralFrenado
              ? "frenado por el umbral, no se pausó"
              : "no se pausó";

  return (
    <>
      {s.ausentes.length > 0 && (
        <Lista titulo="El proveedor ya no los devuelve (al cerrar la corrida):">
          {s.ausentes.map((id) => (
            <p key={id} className="text-foreground/60">
              [{id}] {nombre(id)} — {estadoAusente(id)}
            </p>
          ))}
        </Lista>
      )}
      {s.yaPausadosFueraDeApi.length > 0 && (
        <Lista titulo="Ya pausados que seguían fuera de la API:">
          {s.yaPausadosFueraDeApi.map((id) => (
            <p key={id} className="text-foreground/60">
              [{id}] {nombre(id)}
            </p>
          ))}
        </Lista>
      )}
      {s.monedaSospechosa > 0 && (
        <p className="text-foreground/60">
          {s.monedaSospechosa} productos con moneda mal informada por el
          proveedor — se ignora y se toman como pesos (dato sucio conocido de
          Zecat).
        </p>
      )}
    </>
  );
}

function Lista({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-medium text-foreground/70">{titulo}</p>
      {children}
    </div>
  );
}

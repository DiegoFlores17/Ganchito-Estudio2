import type { SyncRunSummary } from "@/lib/sync-run";
import { MOTIVO_FUERA_DE_TOPE, textoNoVerificado, textoNoVerificados } from "@/lib/sync/textos";

/// Los no verificados de una corrida, agrupados por por que. Los de antes
/// del detalle (corridas viejas) no tienen motivo: no se les promete nada.
function gruposNoVerificados(s: SyncRunSummary) {
  const grupos = new Map<string, { permanente: boolean; motivo: string; cantidad: number }>();
  let sinDetalle = 0;
  for (const id of s.noVerificados) {
    const d = s.noVerificadosDetalle?.[id];
    if (!d) {
      sinDetalle++;
      continue;
    }
    // Los transitorios van juntos (el texto no depende del motivo), salvo
    // los que quedaron fuera del tope: a esos nadie les pregunto.
    const clave = d.permanente ? `p:${d.motivo}` : d.motivo === MOTIVO_FUERA_DE_TOPE ? "tope" : "t";
    const g = grupos.get(clave) ?? { permanente: d.permanente, motivo: d.motivo, cantidad: 0 };
    g.cantidad++;
    grupos.set(clave, g);
  }
  return { grupos: [...grupos.values()], sinDetalle };
}

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
  proveedor = "el proveedor",
}: {
  summary: SyncRunSummary;
  /// Nombre visible del proveedor, para "CDO Promocionales no respondió".
  proveedor?: string;
  /// Pausados DESPUES del cierre con "Pausar estos N" (no estan en el
  /// resumen, que es fijo: salen de autoPausedExternalIds).
  pausadosDespues?: number;
}) {
  const s = summary;
  const avisos: React.ReactNode[] = [];
  if (s.autoPausados.length > 0) {
    avisos.push(
      <span className="text-primary-dark">
        {s.autoPausados.length} pausados automáticamente (el proveedor confirmó
        la baja)
      </span>
    );
  }
  if (s.umbralFrenado) {
    avisos.push(
      <span className="font-medium text-primary-dark">
        ⚠ {s.ausentes.length} ausentes de golpe, más que el límite de{" "}
        {s.umbral}: no se pausó ninguno
      </span>
    );
  }
  if (pausadosDespues > 0) {
    avisos.push(
      <span className="text-primary-dark">
        {pausadosDespues} pausados después desde el panel
      </span>
    );
  }
  if (s.aRevisar.length > 0) {
    avisos.push(
      <span className="font-medium text-primary-dark">
        {s.aRevisar.length} a revisar (siguen publicados pero no vinieron en el
        listado)
      </span>
    );
  }
  if (s.noVerificados.length > 0) {
    const { grupos, sinDetalle } = gruposNoVerificados(s);
    for (const g of grupos) {
      avisos.push(
        <span className={g.permanente ? "font-medium text-amber-800" : "text-primary-dark"}>
          {textoNoVerificados(g.cantidad, g.permanente, g.motivo, proveedor)}
        </span>
      );
    }
    if (sinDetalle > 0) {
      avisos.push(
        <span className="text-primary-dark">
          {sinDetalle} no se {sinDetalle === 1 ? "pudo" : "pudieron"} verificar
        </span>
      );
    }
  }
  if ((s.retenidosSinFoto?.length ?? 0) > 0) {
    avisos.push(
      <span className="font-medium text-primary-dark">
        ⚠ {s.retenidosSinFoto!.length} sin foto retenidos
        {s.rachaSinFoto
          ? " (sigue la racha: no se apagó ninguno)"
          : ` (se llegó al límite de ${s.apagadosSinFoto?.length ?? 0} apagados)`}
        : siguen a la venta
      </span>
    );
  }
  if ((s.apagadosSinFoto?.length ?? 0) > 0) {
    avisos.push(
      <span className="text-primary-dark">
        {s.apagadosSinFoto!.length} apagados por quedarse sin foto
      </span>
    );
  }
  if (s.yaPausadosFueraDeApi.length > 0) {
    avisos.push(<>{s.yaPausadosFueraDeApi.length} ya pausados siguen fuera de la API</>);
  }
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
      {avisos.length > 0 && (
        <p className="text-xs text-foreground/60">
          {/* El separador va ENTRE avisos: pegado al final de cada uno, el
              ultimo dejaba un "·" suelto. */}
          {avisos.map((aviso, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {aviso}
            </span>
          ))}
        </p>
      )}
    </>
  );
}

/// Las listas con nombre de una corrida, para el detalle expandido.
export function SyncRunSummaryDetail({
  summary,
  pausadosDespues,
  proveedor = "el proveedor",
}: {
  summary: SyncRunSummary;
  pausadosDespues: string[];
  proveedor?: string;
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
            ? s.noVerificadosDetalle?.[id]
              ? `${textoNoVerificado(s.noVerificadosDetalle[id].permanente, s.noVerificadosDetalle[id].motivo, proveedor)}; no se pausó`
              : "no se pudo verificar, no se pausó"
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

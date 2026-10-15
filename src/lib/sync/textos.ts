/// Textos del sync que se muestran en mas de un lugar (mail y panel). Sin
/// dependencias de servidor: lo importan componentes de cliente.

/// Motivo de los ausentes que no se llegaron a consultar porque la corrida
/// ya habia hecho el maximo de confirmaciones. Es transitorio, pero NO es
/// que el proveedor no respondio: nadie le pregunto.
export const MOTIVO_FUERA_DE_TOPE = "Quedó fuera del tope de confirmaciones de esta corrida.";

/// Por que un ausente no se pudo verificar, dicho para el admin.
/// - Permanente: nunca promete un reintento, porque no va a salir.
/// - Fuera del tope: no se pregunto; queda para las proximas corridas.
/// - Transitorio: el proveedor no respondio; la proxima corrida reintenta.
export function textoNoVerificado(permanente: boolean, motivo: string, proveedor: string): string {
  if (permanente) return `no se puede verificar: ${motivo}. Revisalo y pausalo a mano si corresponde`;
  if (motivo === MOTIVO_FUERA_DE_TOPE) {
    return "no se verificó: quedó fuera del tope de confirmaciones de esta corrida (queda para las próximas)";
  }
  return `no se pudo verificar: ${proveedor} no respondió (se reintenta en la próxima corrida)`;
}

/// Lo mismo para la linea del resumen, con cantidad: "1 no se pudo
/// verificar…", "3 no se pudieron verificar…".
export function textoNoVerificados(
  cantidad: number,
  permanente: boolean,
  motivo: string,
  proveedor: string
): string {
  const uno = cantidad === 1;
  if (!permanente && motivo === MOTIVO_FUERA_DE_TOPE) {
    return `${cantidad} ${uno ? "no se verificó" : "no se verificaron"}: ${uno ? "quedó" : "quedaron"} fuera del tope de confirmaciones de esta corrida (${uno ? "queda" : "quedan"} para las próximas)`;
  }
  return permanente
    ? `${cantidad} ${uno ? "no se puede" : "no se pueden"} verificar: ${motivo}. ${uno ? "Revisalo y pausalo" : "Revisalos y pausalos"} a mano si corresponde`
    : `${cantidad} ${uno ? "no se pudo" : "no se pudieron"} verificar: ${proveedor} no respondió (${uno ? "se reintenta" : "se reintentan"} en la próxima corrida)`;
}

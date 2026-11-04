/// Guarda por corrida de los precios de personalizacion de Zecat
/// (ProductPrintingLevel), modulo PURO.
///
/// Un producto con el set de niveles roto, o al que Zecat deja de mandarle
/// `printing_types`, se escribe con CERO niveles. Uno solo es ruido del
/// proveedor. Cientos de golpe son un cambio de contrato (un campo renombrado,
/// una respuesta degradada) y borrarian los precios de personalizacion de todo
/// el catalogo sin que nada falle.
///
/// Mismo mecanismo que el tope de "sin foto" de CDO (ver motor.ts): el motor
/// le pasa al conector `puedeQuitarNiveles`; cuando la corrida ya quito el
/// umbral de seguridad de productos (el MISMO de siempre: max(10, 5 % de los
/// activos), umbralDeSeguridad), los siguientes que perderian todos sus
/// niveles RETIENEN los viejos —niveles y recargo—, y se alerta por mail. Y es
/// por RACHA: si la ultima corrida completa llego al tope, esta no quita
/// ninguno hasta que una complete por debajo (rachaNivelesActiva), asi una
/// degradacion que dure dias quita como mucho el umbral EN TOTAL, no por corrida.
///
/// Por que el mismo umbral y no uno propio: la asimetria es la misma. Retener
/// de mas deja precios de personalizacion viejos un rato (la cotizacion igual
/// se revisa a mano y ve "estimado"); quitar de mas deja productos sin precio
/// de personalizacion hasta la proxima corrida sana.

/// Lo que pasa con un producto frente a la guarda.
/// - `perdia`: tenia niveles y el set nuevo no tiene NINGUNO (roto o ausente).
/// - `retenido`: perdia, pero no habia cupo: se conservan los viejos.
export function decidirNiveles(entrada: {
  tenia: number;
  nuevos: number;
  puedeQuitar: boolean;
}): { perdia: boolean; retenido: boolean } {
  const perdia = entrada.tenia > 0 && entrada.nuevos === 0;
  return { perdia, retenido: perdia && !entrada.puedeQuitar };
}

/// Si la corrida llego al tope de perdidas de niveles. Sin racha, el motor
/// quita hasta el umbral y retiene el resto: hay retenidos solo si se paso.
/// Con racha no se quita ninguno y todos quedan retenidos: se paso si los que
/// se habrian quitado superan el umbral. Por debajo, la racha se corta y la
/// proxima corrida aplica. (Misma cuenta que topeSinFoto en finishSyncRun.)
export function topeNiveles(entrada: { retenidos: number; umbral: number; racha: boolean }): boolean {
  return entrada.racha ? entrada.retenidos > entrada.umbral : entrada.retenidos > 0;
}

/// Lo que el conector le anota a la corrida de un producto (solo cuando hay
/// algo que anotar: el set vino roto o el producto perdio sus niveles).
export interface AvisoNiveles {
  causa: "roto" | "ausente";
  perdia: boolean;
  retenido: boolean;
}

/// Una entrada de SyncRun.sinNivelesExternalIds.
export interface EntradaNiveles extends AvisoNiveles {
  id: string;
}

/// Sin repetidos: si una invocacion murio entre el commit de un producto y el
/// registro de su avance, ese producto se reproceso y pudo anotarse dos
/// veces. Vale la ULTIMA anotacion de cada id.
export function ultimaEntradaPorId(lista: EntradaNiveles[]): EntradaNiveles[] {
  return [...new Map(lista.map((e) => [e.id, e])).values()];
}

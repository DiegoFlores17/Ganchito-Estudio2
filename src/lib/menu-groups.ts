/// Sin dependencias de Prisma a proposito: esto lo importan componentes de
/// CLIENTE (el menu del header y el filtro del catalogo) ademas del server.
/// Si viviera en catalog.ts, importarlo del lado del cliente arrastraria el
/// cliente de Prisma entero al bundle — el mismo motivo por el que
/// formatPriceArs vive en lib/format.ts.

/// Encabezado de las categorias visibles que nadie agrupo.
///
/// LO PONE EL FRONT, NO ES UN VALOR GUARDADO. La diferencia importa: una
/// categoria sin grupo tiene `menuGroup` en NULL, y ese null es la señal de
/// que falta mapearla. Si "Otras" fuera un grupo real que se puede asignar
/// desde el panel, esas categorias pasarian a contar como agrupadas y la
/// señal se perderia — quedarian escondidas en un cajon con nombre propio,
/// que es justo lo que este proyecto viene evitando.
///
/// Por eso la accion del panel RECHAZA este valor (ver setCategoryMenuGroup).
export const GRUPO_SIN_AGRUPAR = "Otras";

/// Si un texto escrito a mano es el encabezado reservado.
///
/// Compara con el mismo criterio que la normalizacion de grupos —
/// mayusculas y acentos— para que "otras" u "OTRAS" tambien se rechacen.
export function esGrupoReservado(valor: string): boolean {
  return (
    valor
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim() === GRUPO_SIN_AGRUPAR.toLowerCase()
  );
}

import { randomUUID } from "crypto";
import { put } from "@vercel/blob";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

/// Logos/arte de cotizacion: contenido de CLIENTES no confiables, puede
/// traer cualquier formato de arte.
export const QUOTE_LOGO_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "pdf",
  "svg",
  "ai",
  "eps",
]);

/// Fotos de producto: las carga un admin (confiable), y tienen que
/// renderizarse inline en el catalogo. Nada de svg/pdf/ai/eps a proposito
/// — no son formatos de foto, y excluir svg es lo que permite servir esto
/// inline con seguridad (un raster no puede traer script embebido).
export const PRODUCT_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

/// La regla real de inline vs. descarga es por EXTENSION, no por origen del
/// archivo: un raster (png/jpg/jpeg/webp) nunca puede traer script embebido,
/// asi que es seguro mostrarlo inline sin importar si vino de un logo de
/// cotizacion o de una foto de producto. Todo lo demas (pdf/svg/ai/eps) se
/// sirve como descarga forzada — un SVG SI puede traer <script>.
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  svg: "image/svg+xml",
  ai: "application/postscript",
  eps: "application/postscript",
};

export class UploadValidationError extends Error {}

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

/// Guarda un archivo subido TAL CUAL (sin parsear ni procesar el
/// contenido) en Vercel Blob, con un nombre generado (nunca el nombre
/// original del cliente), y devuelve la URL para servirlo. Blob resuelve
/// inline vs. descarga forzada el mismo (ver CONTENT_TYPES / downloadUrl),
/// no hace falta un route handler propio.
export async function saveUploadedFile(
  file: File,
  { subdir, allowedExtensions }: { subdir: string; allowedExtensions: Set<string> }
): Promise<string> {
  const extension = getExtension(file.name);
  if (!allowedExtensions.has(extension)) {
    throw new UploadValidationError(
      `Formato no permitido${extension ? ` (.${extension})` : ""}. Aceptamos: ${[...allowedExtensions].join(", ")}.`
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new UploadValidationError(
      "El archivo supera el tamaño maximo permitido (15MB)."
    );
  }

  const filename = `${randomUUID()}.${extension}`;
  const blob = await put(`${subdir}/${filename}`, file, {
    access: "public",
    addRandomSuffix: false,
    contentType: CONTENT_TYPES[extension],
  });

  return PRODUCT_IMAGE_EXTENSIONS.has(extension) ? blob.url : blob.downloadUrl;
}

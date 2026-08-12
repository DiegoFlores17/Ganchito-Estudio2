import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

// Storage LOCAL para desarrollo unicamente. El filesystem de las funciones
// serverless de Vercel es efimero (no persiste entre requests/deploys), asi
// que esto NO sirve en produccion. Antes de deployar hay que migrar
// saveUploadedFile() a Vercel Blob — es el unico punto que hay que tocar
// (ver PENDIENTES.md). Esto afecta DOS flujos que comparten esta funcion:
// logos de cotizacion y fotos de producto — verificar los dos al migrar.
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

/// Logos/arte de cotizacion: contenido de CLIENTES no confiables, puede
/// traer cualquier formato de arte. Se sirven siempre como descarga forzada
/// (ver route handler) — un SVG puede traer script embebido.
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

export class UploadValidationError extends Error {}

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

/// Guarda un archivo subido TAL CUAL (sin parsear ni procesar el
/// contenido) con un nombre generado (nunca el nombre original del
/// cliente) y devuelve la URL para servirlo. Que se sirva inline o como
/// descarga forzada lo decide el route handler de /api/uploads segun la
/// extension, no esta funcion.
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
  const dir = path.join(UPLOADS_ROOT, subdir);
  await mkdir(dir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  return `/api/uploads/${subdir}/${filename}`;
}

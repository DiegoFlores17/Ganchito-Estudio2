import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

// Storage LOCAL para desarrollo unicamente. El filesystem de las funciones
// serverless de Vercel es efimero (no persiste entre requests/deploys), asi
// que esto NO sirve en produccion. Antes de deployar hay que migrar
// saveUploadedFile() a Vercel Blob — es el unico punto que hay que tocar
// (ver PENDIENTES.md).
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
const ALLOWED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "pdf",
  "svg",
  "ai",
  "eps",
]);

export class UploadValidationError extends Error {}

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

/// Guarda un archivo subido TAL CUAL (sin parsear ni procesar el
/// contenido) con un nombre generado (nunca el nombre original del
/// cliente) y devuelve la URL para servirlo. Se sirve siempre como
/// descarga adjunta, nunca inline — ver route handler de /api/uploads.
export async function saveUploadedFile(
  file: File,
  { subdir }: { subdir: string }
): Promise<string> {
  const extension = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new UploadValidationError(
      `Formato no permitido${extension ? ` (.${extension})` : ""}. Aceptamos: ${[...ALLOWED_EXTENSIONS].join(", ")}.`
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

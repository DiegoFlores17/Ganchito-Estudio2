import { randomUUID } from "crypto";
import { put } from "@vercel/blob";
import sharp from "sharp";

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

/// Valida que el CONTENIDO del archivo corresponda a su extension, no solo
/// el nombre. Sin esto, cualquier binario renombrado a .png entra y se sirve
/// inline con content-type de imagen.
///
/// Por tipo:
/// - Raster (png/jpg/jpeg): sharp lee los metadatos SIN recomprimir — el
///   archivo que se guarda es el original byte a byte. Es arte del cliente:
///   degradarlo seria perder informacion que no es nuestra (a diferencia de
///   las fotos de producto, que si se recomprimen en saveProductImage).
/// - PDF: magic bytes "%PDF".
/// - AI/EPS: "%!PS" (PostScript clasico) o "%PDF" — los .ai modernos son
///   PDF por dentro, rechazarlos rompe justo el formato que mas mandan los
///   disenadores.
/// - SVG: sin validacion de contenido A PROPOSITO. Puede traer <script>,
///   por eso se sirve SIEMPRE con descarga forzada (nunca inline) y eso es
///   lo que lo hace seguro — validarlo no cambiaria nada.
async function validateFileContent(
  buffer: Buffer,
  extension: string
): Promise<void> {
  const fail = () => {
    throw new UploadValidationError(
      `El archivo no parece ser un .${extension} válido. Verificá que no esté dañado.`
    );
  };

  if (extension === "png" || extension === "jpg" || extension === "jpeg") {
    try {
      const metadata = await sharp(buffer).metadata();
      const esperado = extension === "png" ? "png" : "jpeg";
      if (metadata.format !== esperado) fail();
    } catch (error) {
      if (error instanceof UploadValidationError) throw error;
      fail();
    }
    return;
  }

  const head = buffer.subarray(0, 5).toString("latin1");
  if (extension === "pdf") {
    if (!head.startsWith("%PDF")) fail();
    return;
  }
  if (extension === "ai" || extension === "eps") {
    if (!head.startsWith("%PDF") && !head.startsWith("%!PS")) fail();
    return;
  }
  // svg y cualquier otro tipo permitido a futuro: sin chequeo de contenido,
  // la seguridad la da la descarga forzada (ver CONTENT_TYPES).
}

/// Guarda un archivo subido SIN recomprimir en Vercel Blob, con un nombre
/// generado (nunca el nombre original del cliente), y devuelve la URL para
/// servirlo. El contenido se VALIDA antes de guardar (ver
/// validateFileContent), pero lo que se sube es el original intacto. Blob
/// resuelve inline vs. descarga forzada el mismo (ver CONTENT_TYPES /
/// downloadUrl), no hace falta un route handler propio.
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

  const buffer = Buffer.from(await file.arrayBuffer());
  await validateFileContent(buffer, extension);

  const filename = `${randomUUID()}.${extension}`;
  const blob = await put(`${subdir}/${filename}`, buffer, {
    access: "public",
    addRandomSuffix: false,
    contentType: CONTENT_TYPES[extension],
  });

  return PRODUCT_IMAGE_EXTENSIONS.has(extension) ? blob.url : blob.downloadUrl;
}

// Las fotos de producto SI se procesan antes de guardar, a diferencia de los
// logos de cotizacion (que se guardan tal cual: son arte del cliente y
// degradarlo seria perder informacion que no es nuestra). Por eso el limite
// de entrada es mas bajo: 5MB alcanza para una foto de celular, y el archivo
// que termina en Blob pesa mucho menos que eso igual.
const PRODUCT_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const PRODUCT_IMAGE_MAX_DIMENSION = 1200;
const PRODUCT_IMAGE_WEBP_QUALITY = 80;

/// Optimiza y guarda una foto de producto: la redimensiona a 1200x1200 como
/// maximo y la convierte a WebP. Se guarda SOLO el resultado, nunca el
/// original. Devuelve la URL directa de Blob (WebP es raster: se sirve
/// inline sin riesgo, ver la nota de CONTENT_TYPES arriba).
export async function saveProductImage(file: File): Promise<string> {
  const extension = getExtension(file.name);
  if (!PRODUCT_IMAGE_EXTENSIONS.has(extension)) {
    throw new UploadValidationError(
      `Formato no permitido${extension ? ` (.${extension})` : ""}. Aceptamos: ${[...PRODUCT_IMAGE_EXTENSIONS].join(", ")}.`
    );
  }
  if (file.size > PRODUCT_IMAGE_MAX_SIZE_BYTES) {
    throw new UploadValidationError(
      "La imagen supera el tamaño maximo permitido (5MB)."
    );
  }

  let optimized: Buffer;
  try {
    optimized = await sharp(Buffer.from(await file.arrayBuffer()))
      .resize(PRODUCT_IMAGE_MAX_DIMENSION, PRODUCT_IMAGE_MAX_DIMENSION, {
        fit: "contain",
        // Las fotos que no son cuadradas se completan con blanco, no se
        // recortan: recortar es destructivo y, como no guardamos el
        // original, un recorte que corta el producto no se puede deshacer.
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        // Nunca agrandar. Una foto mas chica que 1200 se centra en el lienzo
        // a su tamaño real en vez de estirarse y quedar borrosa; el lienzo
        // igual sale 1200x1200, asi la grilla del catalogo queda pareja.
        withoutEnlargement: true,
      })
      .webp({ quality: PRODUCT_IMAGE_WEBP_QUALITY })
      .toBuffer();
  } catch {
    // sharp falla si el archivo no es una imagen real aunque la extension
    // diga que si — es una validacion de CONTENIDO que antes no teniamos.
    throw new UploadValidationError(
      "No pudimos procesar la imagen. Verifica que sea un archivo de imagen valido."
    );
  }

  // Siempre .webp: la conversion es parte del procesamiento, la extension de
  // entrada ya no describe el archivo que se guarda.
  const blob = await put(`products/${randomUUID()}.webp`, optimized, {
    access: "public",
    addRandomSuffix: false,
    contentType: CONTENT_TYPES.webp,
  });

  return blob.url;
}

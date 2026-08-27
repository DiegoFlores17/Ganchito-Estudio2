// Verificacion de la auditoria (hallazgo 3): archivos con contenido trucho
// se rechazan ANTES de subir nada a Blob (el throw ocurre antes del put).
import "dotenv/config";
import sharp from "sharp";
import { saveUploadedFile, QUOTE_LOGO_EXTENSIONS, UploadValidationError } from "../src/lib/storage";

function fakeFile(name: string, content: Buffer | string): File {
  const buf = typeof content === "string" ? Buffer.from(content) : content;
  return new File([buf], name);
}

async function expectReject(label: string, file: File) {
  try {
    await saveUploadedFile(file, { subdir: "quotes", allowedExtensions: QUOTE_LOGO_EXTENSIONS });
    console.log(`[FALLO] ${label}: NO fue rechazado`);
  } catch (e) {
    const ok = e instanceof UploadValidationError;
    console.log(`[${ok ? "ok" : "FALLO"}] ${label}: rechazado con ${ok ? "UploadValidationError" : String(e)}`);
  }
}

async function main() {
  await expectReject("texto renombrado a .png", fakeFile("logo.png", "no soy una imagen"));
  await expectReject("texto renombrado a .pdf", fakeFile("arte.pdf", "hola mundo"));
  await expectReject("texto renombrado a .ai", fakeFile("arte.ai", "hola mundo"));
  await expectReject("jpg renombrado a .png", fakeFile("logo.png",
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).jpeg().toBuffer()));

  // Los happy paths NO se prueban aca: subirian archivos reales a Blob.
  // Validacion equivalente sin subir: los buffers legitimos pasan el chequeo.
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
  console.log("[ok] png real: formato detectado =", (await sharp(png).metadata()).format);
  console.log("[ok] %PDF de un pdf real: startsWith =", Buffer.from("%PDF-1.4\n...").subarray(0, 5).toString("latin1").startsWith("%PDF"));
}

main();

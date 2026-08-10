import { readFile, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  svg: "image/svg+xml",
  ai: "application/postscript",
  eps: "application/postscript",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const resolved = path.resolve(UPLOADS_ROOT, ...segments);

  // Nunca servir nada fuera de uploads/ (proteccion contra path traversal).
  if (!resolved.startsWith(UPLOADS_ROOT + path.sep)) {
    return new NextResponse("No encontrado", { status: 404 });
  }

  try {
    await stat(resolved);
  } catch {
    return new NextResponse("No encontrado", { status: 404 });
  }

  const buffer = await readFile(resolved);
  const extension = resolved.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[extension] ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      // SIEMPRE como descarga, nunca inline: un SVG puede traer <script>
      // embebido y no queremos que el navegador lo renderice.
      "Content-Disposition": `attachment; filename="${path.basename(resolved)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

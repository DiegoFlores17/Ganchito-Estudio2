import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { proveedorDeSlug } from "@/lib/sync/conectores";
import { avanzarCorrida } from "@/lib/sync/motor";
import { revisarAlertas } from "@/lib/sync/alertas";

/// Tick del sync automatico de un proveedor. Lo llama Vercel Cron cada
/// minuto DENTRO de las ventanas declaradas en vercel.json (Zecat:
/// "* 9-10,21-22 * * *": dos horas desde las 06:00 y las 18:00 ART). Cada
/// tick avanza ~45 s de la corrida
/// abierta, o arranca una si la ultima completa tiene mas de 6 h. Ver
/// lib/sync/motor.ts.
///
/// 120 s: el presupuesto del tick (45 s) mas el cierre de la corrida
/// (confirmar ausentes, hasta ~75 s si el proveedor esta lento). El lease
/// dura 150 s, mas que esto: mientras la funcion vive, nadie se la saca.
export const maxDuration = 120;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  // Misma proteccion que el cron del dolar: sin la variable, cerrado.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET no está configurado en el entorno." },
      { status: 503 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { provider: slug } = await params;
  const provider = proveedorDeSlug(slug);
  if (!provider) {
    return NextResponse.json({ error: `Proveedor desconocido: ${slug}` }, { status: 404 });
  }

  // Interruptor: apagado, el endpoint no toca NADA (ni corridas, ni
  // alertas). Asi el cron puede estar declarado y frenarse sin deploy.
  const supplier = await prisma.supplier.findUnique({ where: { origin: provider } });
  if (!supplier?.autoSyncEnabled) {
    return NextResponse.json({ skipped: "disabled" });
  }

  const tick = await avanzarCorrida(provider, "cron", { esCron: true });

  if (tick.estado === "completa") {
    // Los costos pueden haber cambiado. Desde un Route Handler esto marca
    // las rutas y se regeneran en la proxima visita (doc de Next 16).
    // Un fallo aca no puede tapar que la corrida termino bien.
    try {
      revalidatePath("/");
      revalidatePath("/catalogo");
    } catch (error) {
      console.error("[cron-sync] No se pudo revalidar la home y el catálogo:", error);
    }
  }

  // Cada tick mira el estado y avisa si cambio (incluye el vigilante de
  // frescura: mas de 26 h sin una corrida completa).
  // Un aviso que falla no puede tapar el resultado del tick.
  let alertas: unknown = null;
  try {
    alertas = await revisarAlertas(provider);
  } catch (error) {
    console.error("[cron-sync] No se pudieron revisar las alertas:", error);
  }

  // 200 siempre que el tick se haya ejecutado: "ocupado" o "sin corrida" no
  // son errores, y una corrida fallida ya quedo registrada y avisada.
  return NextResponse.json({ tick, alertas });
}

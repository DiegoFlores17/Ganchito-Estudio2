import { NextResponse } from "next/server";
import { refreshUsdRate } from "@/lib/usd-rate";

/// Actualiza la cotización del dólar. Lo llama Vercel Cron.
///
/// **Va como endpoint y no dentro de un render**: el render de una página no
/// es lugar para escribir en la base ni para esperar a una API externa. Este
/// proyecto ya se comió un build caído por meter una escritura en el render
/// del Footer (ver getSiteConfig en lib/site-config.ts).
///
/// La protección es `CRON_SECRET`: Vercel manda automáticamente
/// `Authorization: Bearer ${CRON_SECRET}` cuando esa variable existe. Sin la
/// variable, el endpoint queda cerrado — es preferible que no funcione a que
/// quede abierto a cualquiera que adivine la URL.
///
/// Todavía NO hay `vercel.json` con el cron: en Hobby la frecuencia máxima es
/// una vez por día y una expresión más frecuente ROMPE el deploy (ver
/// PENDIENTES). Mientras tanto, el panel tiene un botón "Actualizar ahora"
/// que llama a la misma función.
export async function GET(request: Request) {
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

  const resultado = await refreshUsdRate();

  // Siempre 200 salvo que no se haya podido consultar: que la API de terceros
  // esté caída no es un error NUESTRO, y devolver 500 haría que Vercel marque
  // el cron como fallido cuando en realidad se comportó bien (dejó el último
  // valor conocido).
  const status = resultado.status === "sin-respuesta" ? 502 : 200;
  return NextResponse.json(resultado, { status });
}

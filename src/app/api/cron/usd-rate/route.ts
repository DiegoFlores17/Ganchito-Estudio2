import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ProductOrigin } from "@prisma/client";
import { refreshUsdRate } from "@/lib/usd-rate";
import { vigilarFrescura } from "@/lib/sync/alertas";

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
/// El cron está declarado en `vercel.json` como `0 19 * * *`. **Las
/// expresiones de Vercel son UTC**, así que son las 16:00 de Argentina.
///
/// La hora no es arbitraria: dolarapi devuelve `fechaActualizacion` a las
/// 18:00Z (15:00 ART), que es el cierre del mercado cambiario. Correr antes
/// de esa hora traería el valor del día anterior. Se deja una hora de margen
/// porque en el plan Hobby la precisión del cron es de ±59 minutos.
///
/// Una expresión MÁS frecuente que diaria rompe el deploy en Hobby (no falla
/// en runtime). Diaria alcanza de sobra para una cotización.
///
/// El panel mantiene el botón "Actualizar ahora", que llama a la misma
/// función, para poder forzarla sin esperar al cron.
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

  // El dolar mueve el precio de todo CDO: la home (cacheada, revalidate =
  // 300) se refresca ya, sin esperar los 5 minutos.
  if (resultado.status === "aplicado") {
    try {
      revalidatePath("/");
    } catch (error) {
      console.error("[usd-rate] No se pudo revalidar la home:", error);
    }
  }

  // Vigilante de frescura del sync de productos, desde AFUERA de su propio
  // cron: si el cron del sync dejo de disparar, este sigue y avisa (mas de
  // 26 h sin una corrida completa). Con el sync automatico apagado no hace
  // nada. Nunca tumba la cotizacion: es un aviso.
  try {
    await vigilarFrescura(ProductOrigin.ZECAT);
  } catch (error) {
    console.error("[usd-rate] No se pudo revisar la frescura del sync:", error);
  }

  // Siempre 200 salvo que no se haya podido consultar: que la API de terceros
  // esté caída no es un error NUESTRO, y devolver 500 haría que Vercel marque
  // el cron como fallido cuando en realidad se comportó bien (dejó el último
  // valor conocido).
  const status = resultado.status === "sin-respuesta" ? 502 : 200;
  return NextResponse.json(resultado, { status });
}

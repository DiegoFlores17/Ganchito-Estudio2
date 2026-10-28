import type { Metadata } from "next";
import { getSiteConfigPublica } from "@/lib/lectura-publica";
import {
  formatearVersionPolitica,
  POLITICA_PRIVACIDAD_VERSION,
} from "@/lib/privacidad";

export const metadata: Metadata = {
  title: "Política de Privacidad · Ganchito Estudio",
  description:
    "Qué datos recolectamos, para qué los usamos y qué derechos tenés sobre ellos.",
};

/// Fecha de última actualización del TEXTO. Sale de la misma constante que
/// se guarda en cada cotización como versión aceptada (ver
/// src/lib/privacidad.ts): si cambia el contenido, se mueve ahí.
///
/// No se usa `new Date()`: eso mostraría la fecha del build y diría que la
/// política cambió cada vez que se deploya cualquier cosa.
const ULTIMA_ACTUALIZACION = formatearVersionPolitica(
  POLITICA_PRIVACIDAD_VERSION
);

/// El contenido es TEXTO LEGAL revisado por el cliente y no se edita sin que
/// él lo pida. Cada afirmación se verificó contra el código antes de
/// publicarse: los campos que pide el formulario (y cuáles son obligatorios),
/// que los logos van a Vercel Blob con `access: "public"`, que el aviso por
/// mail le llega a Ganchito y no al cliente, que no hay analytics ni píxeles
/// de terceros, que las fuentes están auto-hospedadas, que el carrito vive en
/// localStorage, y que las fotos del catálogo se cargan desde servidores de
/// los proveedores. Las regiones se confirmaron en los paneles el
/// 2026-10-28: funciones y Blob en `gru1`, Neon en `sa-east-1`, Resend en
/// São Paulo. Si alguna cambia (otro store, otra región), este texto deja de
/// ser cierto.
///
/// La versión completa para el abogado, con los datos que faltan marcados,
/// está en docs/privacidad-borrador-abogado.md.
///
/// Si el sitio cambia lo que hace —un campo nuevo en el formulario, una
/// herramienta de analytics, pagos online— esta página queda desactualizada y
/// hay que avisarle al cliente para que la corrija. Una política que declara
/// tratamientos que no se hacen (o que omite los que sí) es peor que no
/// tenerla.
export default async function PrivacidadPage() {
  const { contactEmail } = await getSiteConfigPublica();

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-4xl font-black tracking-tight text-foreground">
        Política de Privacidad
      </h1>
      <p className="mt-2 text-sm text-foreground/50">
        Última actualización: {ULTIMA_ACTUALIZACION}
      </p>

      <p className="mt-8 text-foreground/80">
        Ganchito Estudio respeta tu privacidad. Esta política explica qué datos
        recolectamos, para qué los usamos y qué derechos tenés sobre ellos.
      </p>

      <Seccion titulo="1. Quiénes somos">
        <p>
          Ganchito Estudio es un estudio de merchandising corporativo. Este
          sitio funciona como catálogo y canal de pedidos de cotización. No es
          una tienda con pago online: no procesamos pagos ni vendemos
          directamente desde el sitio.
        </p>
        <p>
          Para consultas sobre esta política, escribinos a{" "}
          <Correo email={contactEmail} />.
        </p>
      </Seccion>

      <Seccion titulo="2. Qué datos recolectamos">
        <p>
          <strong className="font-medium text-foreground">
            Cuando pedís una cotización
          </strong>
          , te pedimos tu{" "}
          <strong className="font-medium text-foreground">
            nombre y correo electrónico
          </strong>{" "}
          (obligatorios) y, si querés,{" "}
          <strong className="font-medium text-foreground">
            teléfono y nombre de tu empresa
          </strong>
          .
        </p>
        <p>
          Estos datos los ingresás vos voluntariamente en el formulario. Sin
          nombre y correo no podemos responderte la cotización.
        </p>
        <p>
          <strong className="font-medium text-foreground">
            Notas de tu pedido.
          </strong>{" "}
          El formulario incluye un campo de texto libre donde podés contarnos
          detalles de lo que necesitás. Lo que escribas ahí se guarda junto al
          resto de tu cotización. Te pedimos que no incluyas datos sensibles ni
          información que no sea necesaria para el pedido.
        </p>
        <p>
          <strong className="font-medium text-foreground">
            Archivos que subís.
          </strong>{" "}
          Si adjuntás tu logo o arte para que lo veamos, el archivo se almacena
          en nuestro servicio de alojamiento con una dirección larga e
          impredecible, que no publicamos en ningún lado ni aparece en
          buscadores: solo la usamos internamente, y figura en el aviso que
          recibimos por correo y en nuestro panel. Aun así, no requiere
          contraseña: quien tenga la dirección exacta puede verlo. Si tu arte es
          confidencial, escribinos antes de subirlo.
        </p>
        <p>
          <strong className="font-medium text-foreground">
            Almacenamiento en tu navegador.
          </strong>{" "}
          Guardamos en tu navegador (almacenamiento local) los productos que
          vas agregando a tu pedido, para que no se pierdan si cerrás la
          página. No contiene tus datos personales y podés borrarlo desde la
          configuración de tu navegador. Nuestro proveedor de alojamiento puede
          poner una cookie técnica de seguridad para distinguir visitantes
          reales de programas automáticos. No usamos cookies de publicidad, de
          analítica ni de seguimiento.
        </p>
        <p>
          <strong className="font-medium text-foreground">
            Registros técnicos.
          </strong>{" "}
          Nuestro proveedor de alojamiento registra datos técnicos de cada
          visita, como la dirección IP, el navegador y la página solicitada,
          por seguridad y para que el sitio funcione. Esos registros se
          conservan por un período limitado y no los usamos para
          identificarte ni para armar perfiles.
        </p>
        <p>
          <strong className="font-medium text-foreground">
            No recolectamos
          </strong>{" "}
          datos de tarjetas ni información bancaria, porque el sitio no procesa
          pagos.
        </p>
      </Seccion>

      <Seccion titulo="3. Para qué los usamos">
        <p>Usamos tus datos únicamente para:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>Preparar y enviarte la cotización que pediste</li>
          <li>Contactarte por email o WhatsApp sobre ese pedido</li>
          <li>Responder tus consultas</li>
        </ul>
        <p>
          No usamos tus datos para publicidad, no armamos perfiles de
          comportamiento y no te enviamos comunicaciones que no hayas pedido.
        </p>
      </Seccion>

      <Seccion titulo="4. Con quién los compartimos">
        <p>No vendemos ni cedemos tus datos a terceros.</p>
        <p>Usamos servicios que procesan datos por cuenta nuestra:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong className="font-medium text-foreground">
              Vercel:
            </strong>{" "}
            alojamiento del sitio y de los archivos que subís.
          </li>
          <li>
            <strong className="font-medium text-foreground">Neon:</strong> base
            de datos donde se guarda tu cotización.
          </li>
          <li>
            <strong className="font-medium text-foreground">Resend:</strong>{" "}
            envío de avisos por correo. Cuando enviás una solicitud, nos manda
            un aviso <em>a nosotros</em> con tus datos y tu pedido. No te
            enviamos un correo automático: te respondemos por email o WhatsApp.
          </li>
          <li>
            <strong className="font-medium text-foreground">
              Google Workspace:
            </strong>{" "}
            nuestra casilla de correo, donde queda ese aviso.
          </li>
        </ul>
        <p>
          La base de datos, los servidores del sitio, los archivos que subís y
          el envío de los avisos están en Brasil. La casilla de correo donde
          queda el aviso es de Google Workspace, y el mensaje de WhatsApp lo
          procesa Meta, cada uno según sus propias condiciones. Estos
          proveedores acceden a los datos solo para prestarnos el servicio. Al
          marcar la casilla de aceptación del formulario de cotización,
          consentís que tus datos se procesen en servidores ubicados fuera de
          Argentina.
        </p>
        <p>
          <strong className="font-medium text-foreground">WhatsApp.</strong>{" "}
          Al enviar la solicitud, se abre WhatsApp con un mensaje ya armado que
          incluye tu nombre, empresa, email y los productos. Si decidís
          enviarlo, ese mensaje lo procesa WhatsApp (Meta Platforms) según su
          propia política de privacidad.
        </p>
        <p>
          También podemos compartir información si una autoridad competente lo
          requiere legalmente.
        </p>
        <p>
          <strong className="font-medium text-foreground">
            Imágenes del catálogo.
          </strong>{" "}
          Las fotos de los productos se cargan desde los servidores de nuestros
          proveedores. Al ver el catálogo, tu navegador se conecta a esos
          servidores, que pueden registrar tu dirección IP como parte de su
          funcionamiento normal. No compartimos con ellos ningún otro dato tuyo.
        </p>
      </Seccion>

      <Seccion titulo="5. Cuánto tiempo los guardamos">
        <p>
          Conservamos los datos de tu cotización mientras sean necesarios para
          atenderte y para cumplir obligaciones comerciales y fiscales. Podés
          pedirnos que los borremos antes (ver punto 6).
        </p>
      </Seccion>

      <Seccion titulo="6. Tus derechos">
        <p>Según la Ley 25.326, tenés derecho a:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong className="font-medium text-foreground">Acceder</strong> a
            los datos que tenemos sobre vos
          </li>
          <li>
            <strong className="font-medium text-foreground">
              Rectificarlos
            </strong>{" "}
            si están mal o desactualizados
          </li>
          <li>
            <strong className="font-medium text-foreground">
              Solicitar su supresión
            </strong>
            , salvo que exista una obligación legal de conservarlos
          </li>
        </ul>
        <p>
          Para ejercerlos, escribinos a <Correo email={contactEmail} />. Te
          respondemos dentro de los plazos que fija la ley.
        </p>
        <p>
          La Agencia de Acceso a la Información Pública es el organismo de
          control de la Ley 25.326 y atiende las denuncias de quienes consideren
          afectados sus derechos.
        </p>
      </Seccion>

      <Seccion titulo="7. Seguridad">
        <p>
          Aplicamos medidas razonables para proteger tus datos: conexiones
          cifradas, acceso restringido al panel de administración y
          almacenamiento en proveedores con estándares de seguridad reconocidos.
        </p>
        <p>
          Ningún sistema es completamente seguro, así que no podemos garantizar
          seguridad absoluta.
        </p>
      </Seccion>

      <Seccion titulo="8. Menores de edad">
        <p>
          Este sitio está dirigido a empresas y personas mayores de 18 años. No
          recolectamos datos de menores de forma intencional.
        </p>
      </Seccion>

      <Seccion titulo="9. Cambios en esta política">
        <p>
          Podemos actualizar esta política. La fecha de última actualización
          figura arriba. Si el cambio es significativo, lo avisamos en el sitio.
        </p>
      </Seccion>
    </div>
  );
}

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-medium text-foreground">{titulo}</h2>
      <div className="mt-3 flex flex-col gap-3 text-foreground/80">
        {children}
      </div>
    </section>
  );
}

/// El email sale de SiteConfig y es editable desde el panel: si Ganchito lo
/// cambia ahí, esta página lo sigue sola. Hardcodearlo obligaría a un deploy
/// para corregir el contacto de una política de privacidad, que es
/// justamente el dato que tiene que estar siempre vigente.
function Correo({ email }: { email: string | null }) {
  if (!email) return <>nuestro correo de contacto</>;
  return (
    <a
      href={`mailto:${email}`}
      className="text-primary underline underline-offset-2 transition-colors hover:text-primary-light"
    >
      {email}
    </a>
  );
}

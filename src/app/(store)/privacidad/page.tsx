import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Política de Privacidad · Ganchito Estudio",
  description:
    "Qué datos recolectamos, para qué los usamos y qué derechos tenés sobre ellos.",
};

/// Fecha de última actualización del TEXTO, escrita a mano.
///
/// No se usa `new Date()`: eso mostraría la fecha del build y diría que la
/// política cambió cada vez que se deploya cualquier cosa. La fecha de una
/// política es una afirmación sobre el contenido, así que se mueve sólo cuando
/// el contenido se mueve.
const ULTIMA_ACTUALIZACION = "15 de septiembre de 2026";

/// El contenido es TEXTO LEGAL revisado por el cliente y no se edita sin que
/// él lo pida. Cada afirmación se verificó contra el código antes de
/// publicarse: los campos que pide el formulario, que los logos van a Vercel
/// Blob con `access: "public"`, que no hay analytics ni píxeles de terceros,
/// que las fuentes están auto-hospedadas, y que las fotos del catálogo se
/// cargan desde servidores de los proveedores.
///
/// Si el sitio cambia lo que hace —un campo nuevo en el formulario, una
/// herramienta de analytics, pagos online— esta página queda desactualizada y
/// hay que avisarle al cliente para que la corrija. Una política que declara
/// tratamientos que no se hacen (o que omite los que sí) es peor que no
/// tenerla.
export default async function PrivacidadPage() {
  const { contactEmail } = await getSiteConfig();

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
          , te pedimos:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>Nombre</li>
          <li>Correo electrónico</li>
          <li>Teléfono</li>
          <li>Nombre de tu empresa</li>
        </ul>
        <p>
          Estos datos los ingresás vos voluntariamente en el formulario. Sin
          ellos no podemos responderte la cotización.
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
          buscadores. Aun así, no requiere contraseña: quien tenga la dirección
          exacta puede verlo. Si tu arte es confidencial, escribinos antes de
          subirlo.
        </p>
        <p>
          <strong className="font-medium text-foreground">
            Datos de navegación.
          </strong>{" "}
          El sitio usa cookies técnicas necesarias para funcionar. No usamos
          cookies de publicidad ni de seguimiento de terceros.
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
              Alojamiento del sitio y base de datos:
            </strong>{" "}
            proveedores de infraestructura en la nube, con servidores fuera de
            Argentina.
          </li>
          <li>
            <strong className="font-medium text-foreground">
              Envío de correos:
            </strong>{" "}
            un servicio de email transaccional, para mandarte la cotización.
          </li>
        </ul>
        <p>
          Estos proveedores acceden a los datos solo para prestarnos el
          servicio. Al usar el sitio, aceptás que tus datos puedan procesarse en
          servidores ubicados fuera de Argentina.
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

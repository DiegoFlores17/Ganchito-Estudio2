/// Mensaje por defecto de la burbuja de WhatsApp, para cuando SiteConfig no
/// tiene uno cargado.
///
/// Es un fallback, no la fuente de verdad: el texto que se usa vive en la base
/// y se edita desde el panel. Esto solo cubre el hueco de una fila sin cargar.
///
/// Vive en su propio modulo y no en `site-config.ts` porque el formulario del
/// panel lo necesita como placeholder y es un componente cliente: `site-config`
/// importa Prisma en el tope, asi que importarlo desde el cliente arrastraria
/// Prisma al bundle del navegador y voltearia el build. Mismo motivo por el que
/// existe `menu-groups.ts` aparte.
export const WHATSAPP_MENSAJE_DEFECTO =
  "Hola, tengo una consulta sobre merchandising";

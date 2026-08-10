DISEÑO.md — Brief de diseño de la tienda Ganchito Estudio

Este archivo define la dirección visual. Los valores de color y el logo REALES están en la carpeta de marca del proyecto (public/brand/ o donde los hayas dejado): usá SIEMPRE esos hex y esos archivos, no los aproximes. Lo de abajo es la dirección; la marca manda.

Dirección general

Minimalista y editorial. Mucho aire, tipografía protagonista, fotos de producto grandes. La contundencia viene del tipo y del espacio en blanco, no de adornos ni efectos. Menos es más: si una decoración no aporta, va afuera.

Importante: esto NO es un clon de la referencia (lamercheria.com.ar). De la referencia tomamos la ESTRUCTURA y el FLUJO; la ESTÉTICA es 100% Ganchito (violeta protagonista, amarillo de acento). No usar el blanco y negro de la referencia como base.

Identidad visual

Paleta oficial de Ganchito (hex reales — configurarlos como colores de marca en Tailwind). Violeta protagonista, amarillo de acento.

Hex	Nombre	Rol
440670	Indigo	Violeta oscuro. Fondos de bloque protagónicos, hero, footer. El color más fuerte.
750098	Mauveine	Violeta medio. Protagonista principal: títulos, elementos de marca.
C744F2	Phlox	Violeta claro/vibrante. Hovers, detalles, estados activos.
FFF835	Yellow	Amarillo de acento. CTAs y highlights. El que puntúa.
FFD91F	School bus yellow	Amarillo cálido. Acento secundario / hover del amarillo.

Más neutros (blancos/grises) para fondos y texto largo, para que respire.

Regla de uso del amarillo: el amarillo NO manda, puntúa. Se usa con restricción (CTAs, subrayados, detalles). El violeta es el protagonista de la marca.

Accesibilidad del amarillo (importante): FFF835 sobre blanco casi no se lee. El amarillo va como FONDO de botón con texto violeta oscuro (440670) encima, o como detalle sobre fondo violeta. Nunca amarillo claro como texto sobre blanco.

Isotipo: el clip ("ganchito"). Usarlo con intención (header, footer, algún detalle), no repetirlo por todos lados.
Tomar las variantes del logo (completo / isotipo solo / claro / oscuro) de la carpeta de marca.
Tipografía
Montserrat en toda la tienda (es la tipografía de la marca Ganchito). Está en Google Fonts; cargarla con next/font/google. El logo es una imagen aparte, pero todos los textos de la interfaz van en Montserrat para mantener coherencia de marca.
Titulares / hero: Montserrat en su peso más pesado (Black / 900) como display. Es lo que le da el carácter editorial.
Cuerpo: Montserrat regular / medium para descripciones, precios y texto largo.
Escala de tipos clara y con jerarquía marcada (títulos muy por encima del cuerpo). El contraste de tamaños es parte del look editorial.
Estructura de páginas
Home
Hero grande y protagónico (el usuario lo pidió impactante): titular fuerte con el display, fondo violeta o foto de producto lifestyle, y doble CTA —uno principal en amarillo ("Ver productos" / "Comprar") y uno secundario ("Contacto" / WhatsApp).
Bloque de categorías "con logo" (Indumentaria, Drinkware, Bolsos, etc.), con fotos grandes y nombre claro. Inspirado en la referencia, con estética Ganchito.
Proceso en pasos (clave para merch personalizado): Explorá → Personalizá → Revisamos → Listo. Explica cómo funciona la compra con logo. Numerado, editorial.
Productos destacados en grilla.
CTA final + footer con isotipo, datos de contacto y WhatsApp.
Listado de productos
Grilla de cards limpias: foto grande, nombre, precio. Filtros por categoría.
Lee de NUESTRA base (Prisma), no de Zecat directo.
Ficha de producto
Foto grande + miniaturas. Título con el display.
Precio: costo × margen (desde PricingConfig). Definir con el usuario si se muestra con IVA incluido (como la referencia) o "+ IVA" aparte (como la página actual de Ganchito). El modelo soporta ambas.
Selector de variante (color/talle) y de cantidad (con mínimo).
Flujo de cotización, NO pago inmediato: botón tipo "Pedir cotización" / "Agregar a mi cotización". El logo se carga en el paso de cotización, no acá.
Mostrar qué personalización admite el producto (áreas / técnicas de impresión), como info, no como editor de imagen.
Cotización
El cliente revisa sus ítems, completa sus datos (nombre, empresa, email, teléfono), sube su logo/arte, y envía. Se guarda como Quote con precios congelados.
Confirmación clara de "recibimos tu solicitud, te contactamos".
Piso de calidad (siempre)
Responsive hasta mobile.
Foco de teclado visible, contraste accesible.
Respetar prefers-reduced-motion si se usa animación.
Copy en español rioplatense, tono cercano y claro. Los botones dicen exactamente qué hacen ("Pedir cotización", no "Enviar").
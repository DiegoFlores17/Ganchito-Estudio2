DISEÑO.md — Brief de diseño de la tienda Ganchito Estudio

Actualizado el 2026-10-15. La dirección visual es la original (agosto de 2026) y sigue valiendo. Se corrigió lo que ya quedó decidido o construido (marcado "Decidido:" o "Hoy:"). El estado completo de lo construido está en HANDOFF.md, y las reglas de negocio en CLAUDE.md.

Este archivo define la dirección visual. Los valores de color y el logo REALES ya están en el proyecto: usá SIEMPRE esos hex y esos archivos, no los aproximes. Lo de abajo es la dirección; la marca manda.
- Logo e isotipo: public/logo-ganchito.svg y public/isotipo-ganchito.svg.
- Colores: tokens de Tailwind en src/app/globals.css (--color-brand-indigo, --color-brand-mauveine, --color-brand-phlox, --color-brand-yellow, --color-brand-yellow-bus).

Dirección general

Minimalista y editorial. Mucho aire, tipografía protagonista, fotos de producto grandes. La contundencia viene del tipo y del espacio en blanco, no de adornos ni efectos. Menos es más: si una decoración no aporta, va afuera.

Importante: esto NO es un clon de la referencia (lamercheria.com.ar). De la referencia tomamos la ESTRUCTURA y el FLUJO; la ESTÉTICA es 100% Ganchito (violeta protagonista, amarillo de acento). No usar el blanco y negro de la referencia como base.

Identidad visual

Paleta oficial de Ganchito (hex reales; hoy ya configurados como colores de marca en Tailwind, ver arriba). Violeta protagonista, amarillo de acento.

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
Hero grande y protagónico (el usuario lo pidió impactante): titular fuerte con el display, fondo violeta o foto de producto lifestyle, y doble CTA —uno principal en amarillo ("Ver productos") y uno secundario ("Contacto" / WhatsApp). No usar "Comprar": no hay pago online, el flujo es cotización.
Bloque de categorías "con logo" (Indumentaria, Drinkware, Bolsos, etc.), con fotos grandes y nombre claro. Inspirado en la referencia, con estética Ganchito.
Proceso en pasos (clave para merch personalizado): Explorá → Personalizá → Revisamos → Listo. Explica cómo funciona la compra con logo. Numerado, editorial.
Productos destacados en grilla.
CTA final + footer con isotipo, datos de contacto y WhatsApp.
Listado de productos
Grilla de cards limpias: foto grande, nombre, precio. Filtros por categoría.
Lee de NUESTRA base (Prisma), no de los proveedores directo. Hoy el catálogo junta Zecat, CDO y productos cargados a mano, con categorías propias.
Ficha de producto
Foto grande + miniaturas. Título con el display.
Precio: costo × margen (desde PricingConfig). Decidido: el IVA va siempre aparte, "$ X + IVA", nunca embebido. En las cards, "Desde $X" solo cuando las variantes tienen precios distintos; si son iguales, el precio exacto.
Selector de variante (color/talle) y de cantidad (con mínimo).
Flujo de cotización, NO pago inmediato: botón tipo "Pedir cotización" / "Agregar a mi cotización". El logo se carga en el paso de cotización, no acá.
Mostrar qué personalización admite el producto (áreas / técnicas de impresión), como info, no como editor de imagen.
Cotización
El cliente revisa sus ítems, completa sus datos (nombre, empresa, email, teléfono), sube su logo/arte, y envía. Se guarda como Quote con precios congelados. Hoy: al enviar, además, se abre WhatsApp con el pedido pre-armado (la Quote se guarda siempre antes; WhatsApp es un extra, no un punto de falla).
Confirmación clara de "recibimos tu solicitud, te contactamos".
Piso de calidad (siempre)
Responsive hasta mobile.
Foco de teclado visible, contraste accesible.
Respetar prefers-reduced-motion si se usa animación.
Copy en español rioplatense, tono cercano y claro. Los botones dicen exactamente qué hacen ("Pedir cotización", no "Enviar").
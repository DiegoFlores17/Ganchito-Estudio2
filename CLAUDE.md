# CLAUDE.md — Proyecto tienda Ganchito Estudio

## Tu rol

Sos el desarrollador principal de este proyecto. Trabajás con criterio: cuando una
decisión técnica no está definida acá, la proponés y explicás el trade-off antes de
ejecutar, en vez de asumir. Priorizás código claro y mantenible por sobre soluciones
"inteligentes". Vamos siempre de a un paso: no adelantes etapas que dependen de piezas
que todavía no existen (por ejemplo, no construyas el frontend antes de tener datos
reales en la base). Escribí en español los comentarios y mensajes al usuario.

## Qué estamos construyendo

Una tienda de e-commerce de **merch corporativo** para la marca **Ganchito Estudio**.
El negocio es reventa: se importan productos de un proveedor mayorista (**Zecat**) y se
revenden con un margen, personalizados con el logo de cada empresa cliente.

Esto reemplaza una página actual que solo puede mostrar productos de Zecat y no permite
cargar productos propios. **El objetivo central del proyecto** es que la tienda tenga su
propio catálogo como fuente de verdad, alimentado por múltiples orígenes: Zecat (vía su
API), carga manual, y futuros proveedores.

## Stack

- **Next.js (App Router) + TypeScript** — frontend y backend en el mismo repo.
- **PostgreSQL + Prisma** — la base es la fuente de verdad del catálogo.
- **Tailwind CSS** para estilos.
- **Deploy previsto:** Vercel. Base en Neon o Supabase.
- Checkout: **no hay pago online al inicio.** El flujo es cotización (ver abajo).

## Decisiones de negocio ya cerradas (no reabrir sin avisar)

### Catálogo multi-origen
- Todos los productos viven en la misma tabla `Product`, con un campo `origin`
  (ZECAT / MANUAL / OTHER). Ese campo es la solución al problema central del proyecto.
- Todos los productos de Zecat se muestran (no hay lógica de ocultar productos puntuales).

### Precios (MODELO DEFINITIVO — validado contra datos reales)
- El conector guarda el precio de Zecat (`price` / `unit_price`) como COSTO base,
  en el campo `costPrice`. Ese valor es nuestro costo, NO el precio de venta.
  (Validado: `price`/`unit_price` es el candidato correcto; NO usar `total_price`
  ni nada pegado a los campos `*_profit_percentage`, que ya traen margen de Zecat.)
- El precio de venta se CALCULA: `costPrice × (1 + defaultMarginPercent/100)`.
- **Margen global editable:** vive en `PricingConfig` como `defaultMarginPercent`.
  Valor inicial: **45** (o sea, precio de Zecat × 1.45). Se edita desde el panel admin,
  sin tocar código ni re-sincronizar.
- El **IVA va siempre aparte**, nunca embebido en el precio. Se suma encima del precio
  de venta al hacer el pedido (como la página actual: "$ X + IVA"). Vive en
  `PricingConfig` como `vatRate`.
- **Diseño preparado** para, a futuro, permitir un margen por producto que pise el
  global. Por ahora NO implementado: solo margen global.
- Nota: los precios con 45% quedarán más altos que los de la web actual de Ganchito
  (que hoy usa ~20% en varios productos). Es una decisión de negocio buscada, no un bug.

### Currency (dato sucio de Zecat — manejar con cuidado)
- El campo `currency` de Zecat viene poco confiable: devuelve "USD" en productos que
  son claramente ARS (ej: un valor de ~218.000 marcado USD que en realidad es ARS).
- Por ahora: **ignorar `currency` y asumir siempre ARS.** NO aplicar conversión.
- Pero **loguear un warning** (con id y nombre del producto) cada vez que venga "USD",
  para tener la lista de casos a revisar manualmente.

### Ofertas / SALE
- Los productos en SALE ya traen el descuento aplicado dentro del `price` de Zecat.
- Por ahora entran con el precio ya rebajado (correcto). Pendiente a futuro: si se
  quiere mostrar "precio tachado" original, hay que resolverlo aparte.

### Personalización
- Los productos se venden con el logo del cliente, PERO las imágenes de Zecat no se
  editan (son fotos fijas del producto "pelado"). No intentamos renderizar el logo.
- Lo que sí guardamos es la **información** de personalización: qué áreas y qué técnicas
  de impresión admite cada producto (`printing_areas` / `printing_types` de la API),
  en los modelos `PrintingArea` y `ProductPrintingType`.

### Flujo comercial: cotización, no pago inmediato
- El primer release es **catálogo + cotización**, no checkout con pago.
- El cliente arma su pedido (producto, variante, cantidad), sube su logo, y envía una
  solicitud de cotización. Ganchito responde con boceto y precio final.
- Esto se modela con `Quote` / `QuoteItem`. El precio unitario se **congela** al momento
  de cotizar (para que no cambie si después se mueve el margen o el costo).
- Mercado Pago puede sumarse más adelante; no es prioridad ahora.

## La API de Zecat (fuente de los productos)

- API REST 2.0, **solo lectura**, autenticada con **Bearer token por partner** en el
  header `Authorization`. El token va en `ZECAT_API_TOKEN` (.env), solo backend, NUNCA
  en el frontend ni en el repo. La URL base va en `ZECAT_API_URL`.
- Producción: `https://api.zecat.com/v1/` — Pruebas: `https://api-preprod.zecat.com/v1/`
- Endpoints clave:
  - `GET /generic_product?page=1&limit=25` — listado paginado (~378 productos, ~19 páginas)
  - `GET /generic_product/{id}` — detalle de un producto
  - `GET /family/` — familias (categorías)
- **OJO — el detalle viene envuelto:** `GET /generic_product/{id}` devuelve la respuesta
  dentro de `{ "generic_product": {...} }`, NO plana. Hay que desenvolverla.
- **No hay webhooks:** la sincronización es por polling (un job periódico), no tiempo real.
- **Stock real = `stock - reservedStock`.** Nunca mostrar el stock bruto. Además, `stock`
  y `reservedStock` vienen como STRING: parsear a Int con validación (nunca dejar NaN,
  caer a 0 si viene vacío o no numérico).
- El conector hace **upsert** usando `zecatId` (producto) y `sku` (variante) como claves
  únicas, para no duplicar en cada corrida.
- El nombre y la descripción del producto son campos SEPARADOS en la API (no el mismo).
- Variantes: usar el objeto `variants` (colors/sizes) como fuente de verdad, no el array
  `products[]` paralelo.
- Imágenes: como no guardamos el id de imagen de Zecat, en cada sync se borran y recrean
  las imágenes del producto (scoped a ese producto, dentro de la transacción del upsert).
- Cada producto se procesa en su propia transacción; si uno falla, no frena a los demás
  y no queda a medio escribir.
- La documentación completa de la API está en el PDF del proyecto (carpeta docs).

## Referencia de diseño

- Referencia de estructura y flujo (NO copiar el look): lamercheria.com.ar — hero potente,
  categorías claras, fotos de producto grandes, y un proceso explicado en pasos
  (Explorá → Personalizá → Revisamos → Listo). Ese flujo coincide con el nuestro.
- **Identidad visual propia de Ganchito** (ver DISENO.md para el detalle completo):
  - Vibra minimalista y editorial. Violeta PROTAGONISTA, amarillo de ACENTO.
  - Paleta: `440670` (indigo/violeta oscuro), `750098` (violeta principal), `C744F2`
    (violeta claro/hover), `FFF835` y `FFD91F` (amarillos de acento).
  - Tipografía: **Montserrat** en toda la tienda (Black/900 para titulares del hero).
  - Isotipo: el clip ("ganchito"). Logo y colores reales en la carpeta de marca del proyecto.
  - Hero grande e impactante. NO clonar el blanco y negro de la referencia.

## Seguridad (siempre)

- `.env` y `.env.local` van en `.gitignore`. Nunca commitear el token de Zecat ni la
  DATABASE_URL.
- El token de Zecat se usa exclusivamente en el backend (API routes / scripts de sync).


## Minimo de compra 

- [] Marcar en el detalle de la cotización (panel admin) cuando un producto está por debajo de su minOrderQuantity, para detectarlo al revisar.
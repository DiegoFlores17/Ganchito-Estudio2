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
El negocio es reventa: se importan productos de proveedores mayoristas (**Zecat** y
**CDO Promocionales / Stocksur**) y se revenden con un margen, personalizados con el
logo de cada empresa cliente.

Esto reemplaza una página actual que solo puede mostrar productos de Zecat y no permite
cargar productos propios. **El objetivo central del proyecto** es que la tienda tenga su
propio catálogo como fuente de verdad, alimentado por múltiples orígenes: Zecat (vía su
API), CDO (vía la suya), carga manual, y futuros proveedores.

## Stack

- **Next.js (App Router) + TypeScript** — frontend y backend en el mismo repo.
- **PostgreSQL + Prisma** — la base es la fuente de verdad del catálogo.
- **Tailwind CSS** para estilos.
- **Deploy previsto:** Vercel. Base en Neon o Supabase.
- Checkout: **no hay pago online al inicio.** El flujo es cotización (ver abajo).

## Decisiones de negocio ya cerradas (no reabrir sin avisar)

### Catálogo multi-origen
- Todos los productos viven en la misma tabla `Product`, con un campo `origin`
  (ZECAT / CDO / MANUAL / OTHER). Ese campo es la solución al problema central
  del proyecto.
- Todos los productos de Zecat se muestran (no hay lógica de ocultar productos puntuales).

### Categorías: las de la tienda son NUESTRAS
- **Un producto pertenece a UNA sola categoría.** `Product.categoryId` es una FK
  simple; los conectores toman la primera que manda el proveedor (`families[0]` en
  Zecat, `categories[0]` en CDO) y descartan el resto. Consecuencia a tener presente:
  sacar una categoría del filtro deja a sus productos sin ninguna vía de filtro.
- **`Category.visible`** decide si se ofrece como filtro. Sirve para el ruido que
  traen los proveedores: campañas ("2026 Agro"), ofertas ("70%OFF...") y cosas que
  no son categorías ("Próximos Arribos", "Logo 24hs"). Ocultar NO oculta productos.
- **`Category.canonicalId`** unifica las homónimas. Zecat y CDO traen los dos una
  "Escritura", una "Tecnología", etc., y el cliente veía dos filtros iguales sin
  forma de distinguirlos. La categoría de proveedor pasa a ser alias de una **propia**
  y sus productos se muestran bajo ella.
- **La canónica es siempre una categoría PROPIA** (sin ids de proveedor), por dos
  razones. Técnica: si fuera de un proveedor, el próximo sync puede renombrarla y
  cambiaría el filtro público solo — Zecat ya nos enseñó que estructuran los datos
  como quieren (el nombre de la familia viene en `description`, no en `name`).
  De negocio: podemos querer llamarle "Lapiceras y escritura" porque así lo buscan
  nuestros clientes, aunque los dos proveedores le digan "Escritura".
- **El mapeo se hace a mano desde el panel, nunca por matcheo automático de nombres.**
  El panel SUGIERE candidatos por nombre normalizado, pero no aplica nada solo. Mismo
  criterio que los iconos de CDO: adivinar por el nombre acierta hoy y falla callado
  mañana. Los contraejemplos ya están en los datos — "Escritorio" y "Escritura" se
  parecen y son distintas; "Hogar" (CDO) y "Hogar y Tiempo Libre" (Zecat) son lo
  mismo y no matchean.
- **Por qué vive en la base y no en el conector:** los conectores escriben
  `categoryId` en cada upsert de cada corrida. Cualquier arreglo hecho reasignando
  productos o borrando la categoría duplicada dura hasta el próximo sync.

### Precios (MODELO DEFINITIVO — validado contra datos reales)

- **El costo vive en `ProductVariant.costPrice`, NO en `Product`.** La columna de
  `Product` se borró. Es así porque hay proveedores con precios distintos por
  variante: en CDO, el producto OCEAN tiene variantes a 194.97 y a 205.23. Un solo
  precio a nivel producto obligaba a mostrarle al cliente un número que no
  corresponde a lo que eligió.
- El conector guarda el precio del proveedor como COSTO base. Ese valor es nuestro
  costo, NO el precio de venta.
  - **Zecat — CORREGIDO el 2026-08-31:** el costo es
    **`price × (1 − discount_partner/100)`**, con `discount_partner` (en %) a
    nivel VARIANTE. `price`/`unit_price` a secas es el **precio sugerido de
    venta al público** (= `final_consumer_price_wepod`) — usarlo como costo
    cobraba un ~43% de más. Verificado al centavo contra el backoffice
    (Bolso Championship 5515: 37311.99 × 0.70 = 26118.39). La "validación"
    anterior comparaba contra un precio de venta de la web vieja, o sea que
    probaba lo contrario de lo que concluía. **Sin fallback**: si
    `discount_partner` no viene o no es válido, el producto NO se importa
    (se loguea, y si existía se pausa) — jamás caer a `price` pelado.
    NO usar `total_price`: es el costo del tramo más profundo de la escala
    de volumen (cobraría de menos en pedidos chicos). `discount_price` y
    `net_price` figuran en la doc pero NO vienen en la respuesta real.
  - **CDO:** `net_price` (no `list_price`).
- El precio de venta se CALCULA al leer: `costPrice × (1 + defaultMarginPercent/100)`,
  convirtiendo antes a pesos si hace falta. Nunca se persiste un precio de venta.
- **Margen global editable:** vive en `PricingConfig` como `defaultMarginPercent`.
  Valor inicial: **45** (o sea, costo × 1.45). Se edita desde el panel admin,
  sin tocar código ni re-sincronizar.
- **Cotización del dólar:** vive en `PricingConfig` como `usdRate`. Los costos en
  USD se convierten **al leer**, no al sincronizar: mover el valor actualiza todo el
  catálogo al instante, sin re-sincronizar. Mismo criterio que el margen.
  - **Se usa el dólar oficial del Banco Nación** (`venta`), vía dolarapi.com.
    `venta` y no `compra` porque es lo que cuesta COMPRAR los dólares para pagarle
    al proveedor.
  - **`usdRateMode` decide si se actualiza sola** (`AUTO`) o queda fija (`MANUAL`).
    El default es MANUAL: una actualización automática que pisa un valor cargado a
    mano mueve el precio de todo el catálogo de CDO por sorpresa. En MANUAL el job
    igual registra el oficial en `usdRateOfficial`, para que el panel muestre la
    diferencia sin cambiar nada.
  - **Si la API falla, no se escribe nada** y queda el último valor conocido. Hay
    una guarda de ±20% contra el valor guardado: estas APIs gratuitas a veces
    devuelven basura, y un cero pondría en CERO el precio de todo el catálogo de CDO
    sin que nada falle.
- El **IVA va siempre aparte**, nunca embebido en el precio. Se suma encima del precio
  de venta al hacer el pedido (como la página actual: "$ X + IVA"). Vive en
  `PricingConfig` como `vatRate`.
- En las cards del catálogo se muestra **"Desde $X"** solo cuando las variantes tienen
  precios distintos; cuando son iguales, el precio exacto. Mostrar un piso es honesto;
  guardarlo como si fuera el precio sería mentir.
- **Al cotizar, el precio se congela por `(productId, variantSku)`.** Si el sku ya no
  existe, la línea se **omite** con un warning en el log, en vez de cobrarla con el
  precio de otra variante.
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

## La API de CDO Promocionales / Stocksur (segundo proveedor)

- API REST, **solo lectura**, autenticada con **`X-Auth-Token`** en el header (no
  Bearer, a diferencia de Zecat). El token va en `CDO_API_TOKEN` (.env), solo
  backend. La URL base va en `CDO_API_URL`.
- Paginación con **`page_size` (máximo 100) + `page_number`**.
- **El listado devuelve exactamente lo mismo que el detalle.** No hace falta pedir
  producto por producto: el catálogo entero se baja en 3 requests. Es la diferencia
  operativa más grande contra Zecat, donde el detalle sí agrega datos.
- **Los precios vienen en DÓLARES.** Se guardan tal cual con `currency: USD` y se
  convierten al leer.

### Las cuatro trampas de CDO (todas verificadas contra datos reales)

**1. CDO REPITE el mismo `sku` en productos DISTINTOS.** Los productos 5798 y 5799
comparten `T625-01+T521T-400MZ`. Como en nuestro schema el sku es la clave única de
`ProductVariant`, el upsert hacía que un producto le **robara** la variante al otro —
y cuál ganaba dependía del orden de procesamiento, así que daba un resultado distinto
en cada corrida. Por eso **el sku se prefija SIEMPRE con el id del producto**
(`cdo-{productId}-{sku}`), no solo al detectar choque: prefijar reactivamente haría
que el sku dependiera de qué más vino en esa página. De paso resuelve las 13 variantes
que vienen con `sku` vacío, que usan el id de la variante.

**2. `stock_available` YA VIENE NETO.** En Zecat el disponible se calcula
(`stock - reservedStock`); en CDO ya está descontado. Verificado sobre las 411
variantes: `available > existent` no pasa nunca. Se guarda `stock = existent` y
`reservedStock = existent - available`, de modo que nuestro cálculo de siempre
devuelve exactamente `available` **y** se conserva el total. Mapear `available`
directo a `reservedStock` daría lo reservado en vez de lo disponible: el error justo
al revés, y no se nota mirando la pantalla.

**3. La cotización del dólar: DECISIÓN REVERTIDA el 2026-08-26.** Antes era manual
a propósito, con este razonamiento: el valor que usa CDO (su web mostraba $1510) es
una **decisión comercial de ellos**, no el dólar de mercado, y una API daría el
oficial y desalinearía nuestros precios contra lo que CDO factura.

**Ahora se usa el oficial del Banco Nación.** Qué cambió: el precio que ve el cliente
es **estimado** —la venta se cierra por WhatsApp y el presupuesto final lo arma
Ganchito a mano— así que no necesita coincidir con la factura de CDO. Lo que sí
importa es que no quede desactualizado, y un valor cargado a mano se olvida.

**El costo asumido, para que quien lea esto lo sepa:** el oficial del BNA **puede
diferir del que factura CDO**. El día que se tomó la decisión eran 1510 (CDO) contra
1535 (BNA), un 1,66%. Esa brecha se va a mover. Si algún día el margen real se
empieza a comer por ahí, la salida es pasar `usdRateMode` a MANUAL desde el panel y
volver a cargar el valor de CDO — no hace falta tocar código.

**4. Los iconos se clasifican por LISTA EXPLÍCITA de ids, nunca por heurística sobre
el texto.** "Grabado láser gratis" y "Grabado en láser" se parecen muchísimo y son
cosas distintas: una condición comercial y una técnica de impresión. Adivinar por el
nombre acierta hoy y falla callado el día que agreguen uno. Los ids se parten en
técnicas de impresión (`ProductPrintingType`) y atributos (`ProductAttribute`); **los
que no están en ninguna lista se loguean** para clasificarlos a mano, no se descartan
en silencio.

### Otras diferencias con Zecat

- **CDO no tiene flag de publicado.** El `active` sale de si el producto tiene alguna
  foto usable; los que no tienen ninguna entran **inactivos** y se reevalúan en cada
  corrida, así que se reactivan solos si les cargan la foto.
- **Las imágenes hay que MEDIRLAS, no alcanza con filtrar por nombre.** CDO devuelve
  `missing.png` cuando no tiene foto (29% de las imágenes en pruebas), pero además
  tiene basura que no es ese placeholder: capturas de pantalla recortadas subidas como
  foto de producto. Rotas y menores a 200px se descartan; las de proporción extrema
  (> 2,5) entran pero se muestran con `object-contain`, porque hay fotos legítimas de
  objetos largos. El sync loguea cuántas cayeron en cada categoría.
- **CDO sirve las imágenes desde CloudFront y el id de la distribución cambia entre
  entornos.** Por eso `next.config.ts` usa el comodín `*.cloudfront.net`. Ojo que un
  host no configurado en `next/image` **rompe la página entera**, no muestra una
  imagen rota.
- **`packing` NO se mapea a las dimensiones del producto:** son medidas del EMBALAJE,
  y además viene null en 160 de 207 casos.
- Igual que Zecat: cada producto en su propia transacción, e imágenes borradas y
  recreadas por sync (no guardamos el id de imagen del proveedor).

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

### Sincronización de proveedores (panel + consola)

- La tabla `SyncRun` es lock + progreso retomable + observabilidad de cada
  corrida. **El historial se conserva a propósito, sin límite ni limpieza**:
  con un sync diario son ~365 filas/año, chicas, y el historial sirve para
  diagnóstico. Es una decisión explícita, no un olvido — si algún día
  molesta, se agrega retención, no se borra callado.
- El lock es un índice único parcial en la base (una sola RUNNING por
  proveedor): el "acquire" es insertar y que la base decida, nunca
  consultar-y-crear. Lo respetan el botón del panel Y los scripts de consola.
- Una RUNNING sin heartbeat por 5 minutos está muerta: se RETOMA desde su
  cursor, no se pisa ni se arranca de cero.

## Seguridad (siempre)

- `.env` y `.env.local` van en `.gitignore`. Nunca commitear los tokens de proveedor
  (`ZECAT_API_TOKEN`, `CDO_API_TOKEN`) ni la DATABASE_URL.
- Los tokens de proveedor se usan exclusivamente en el backend (API routes / scripts
  de sync). Nunca en el frontend.
- **El `.env` apunta SIEMPRE a la base local.** Producción (Neon) se toca únicamente
  pasando `DATABASE_URL=...` adelante del comando, y solo cuando se pide
  explícitamente. Antes de cualquier escritura, verificar el destino **en el mismo
  comando** que la escritura, con una guarda que aborte — no confiando en un chequeo
  anterior. El detalle está en `HANDOFF.md`, sección "Regla de entornos".
- **Vercel NO aplica migraciones.** Neon se migra a mano, y siempre ANTES de pushear
  código que lea columnas nuevas.



<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

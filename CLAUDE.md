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

### Precios
- Se guarda **solo el costo** (`costPrice`, lo que devuelve la API de Zecat).
- El precio de venta se **calcula**: `costo * (1 + margen)`. NO se guarda hardcodeado.
- El **margen es fijo y global**, y vive en la tabla `PricingConfig` (una sola fila),
  para poder cambiarlo sin tocar código ni re-sincronizar.
- El **IVA va siempre aparte**, nunca embebido en el precio base. Se calcula/muestra
  por separado. (La página actual muestra "$ X + IVA".)
- Zecat puede devolver costos en ARS o USD (`currency`). Normalizar USD→ARS con el
  `usdToArsRate` de `PricingConfig`.

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
  en el frontend ni en el repo.
- Producción: `https://api.zecat.com/v1/` — Pruebas: `https://api-preprod.zecat.com/v1/`
- Endpoints clave:
  - `GET /generic_product?page=1&limit=25` — listado paginado (~378 productos, ~19 páginas)
  - `GET /generic_product/{id}` — detalle de un producto
  - `GET /family/` — familias (categorías)
- **No hay webhooks:** la sincronización es por polling (un job periódico), no tiempo real.
- Stock real = `stock - reservedStock`. Nunca mostrar el stock bruto.
- El conector hace **upsert** usando `zecatId` (producto) y `sku` (variante) como claves
  únicas, para no duplicar en cada corrida.
- La documentación completa de la API está en el PDF que te voy a pasar cuando trabajemos
  el conector.

## Referencia de diseño

- Referencia de estructura y flujo (NO copiar el look): lamercheria.com.ar — hero potente,
  categorías claras, fotos de producto grandes, y un proceso explicado en pasos
  (Explorá → Personalizá → Revisamos → Listo). Ese flujo coincide con el nuestro.
- **Identidad visual propia de Ganchito:** paleta violeta + amarillo, isotipo de un clip
  ("ganchito"). El diseño debe ser inconfundiblemente Ganchito, no un clon en blanco y
  negro de la referencia.

## Seguridad (siempre)

- `.env` y `.env.local` van en `.gitignore`. Nunca commitear el token de Zecat ni la
  DATABASE_URL.
- El token de Zecat se usa exclusivamente en el backend (API routes / scripts de sync).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

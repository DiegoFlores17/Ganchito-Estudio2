# Auditoría pre-entrega — 2026-08-27

Rama `auditoria-pre-entrega`, solo local. Tres frentes: seguridad, calidad,
rendimiento. Ordenado por prioridad real, no por categoría. Al final, la lista
de lo que se revisó y NO es problema — vale tanto como los hallazgos.

**Estado (2026-08-27):** hallazgos **1, 3, 4 y 6 atacados y verificados** en
esta rama (ver los commits y los scripts `scripts/audit-verify-*.ts`, que se
pueden re-correr contra la base local). Los hallazgos **2, 5, 7 y 9 quedaron
anotados en PENDIENTES** con su cuándo. El 8 se resolvió en la parte que
tocaba código vivo (el helper de stock ahora se usa); el resto es cosmético.

---

## 1. 🔴 `submitQuote` no valida la entrada que le llega (ALTA)

**Qué**: la única Server Action pública del sitio acepta `items` de un
`JSON.parse` sin validar nada de su contenido:

- **`quantity` no se chequea**: acepta negativos y cero. Una cantidad negativa
  entra a la base y produce un subtotal negativo en el panel. Un decimal
  revienta en Prisma (`quantity Int`) con un error 500 en vez de un mensaje.
- **El array no tiene tope**: 10.000 items generan una consulta `id: { in: [...] }`
  de 10.000 ids y 10.000 `QuoteItem` en una sola transacción.
- **No filtra `active` ni `deletedAt`**: `where: { id: { in: productIds } }` a
  secas. Un producto **eliminado o pausado se puede cotizar igual** si el id
  quedó en el localStorage del cliente. El comentario del código dice
  "producto ya no existe/inactivo: se omite", pero el código no lo hace — solo
  omite los que no existen físicamente. Rompe la regla del propio proyecto
  ("toda consulta de productos filtra deletedAt, sin excepciones", en
  `home.ts`), y es exactamente el tipo de suposición implícita que ya mordió.

**Dónde**: `src/app/(store)/cotizar/actions.ts` — `submitQuote` y
`getQuoteItemsSummary` (las dos son públicas, las dos sin filtros).

**Costo**: bajo. Validar `Number.isInteger(q) && q > 0 && q <= tope`, cap del
array (50 items sobra), y sumar `active: true, deletedAt: null` a los dos
`where`. Una tarde con verificación incluida.

---

## 2. 🟠 El formulario público no tiene ninguna protección anti-abuso (MEDIA-ALTA)

**Qué**: `submitQuote` puede llamarse en loop sin fricción: no hay rate limit,
captcha ni honeypot. Cada llamada escribe una fila `Quote` + items, y si trae
archivo, **sube hasta 15MB a Vercel Blob** — que factura por almacenamiento.
Un script trivial llena la base de cotizaciones basura y el Blob de archivos
huérfanos (que además ya no se borran nunca, ver PENDIENTES).

**Dónde**: `src/app/(store)/cotizar/actions.ts` + `src/lib/storage.ts`.

**Costo**: medio. La versión barata: honeypot en el form + un rate limit por
IP en memoria no sirve en serverless — necesita Upstash/Redis o el firewall de
Vercel. La versión pragmática para este release: honeypot + tope de tamaño ya
existente + alerta si el volumen de cotizaciones se dispara. Evaluar según
cuánta exposición pública real va a tener el sitio al lanzar.

---

## 3. 🟠 Los logos de cotización se validan solo por extensión (MEDIA)

**Qué**: `saveUploadedFile` chequea extensión y tamaño, nunca el contenido.
Cualquier binario renombrado a `.png` entra y se sirve **inline** con
`content-type: image/png` desde el dominio de Blob. Las fotos de producto SÍ
validan contenido (sharp las procesa y falla si no son imagen real); los logos
no, y son justamente los que suben desconocidos.

**Mitigantes reales** (por eso no es alta): los tipos peligrosos (svg/pdf/ai/eps)
se sirven con descarga forzada, nunca inline; los nombres son UUID (no
adivinables, no colisionables); y el dominio de Blob es ajeno al del sitio, así
que un HTML disfrazado no puede robar cookies del sitio ni con sniffing.

**Dónde**: `src/lib/storage.ts` (`saveUploadedFile`), usado por
`submitQuote`.

**Costo**: bajo. Para los raster (png/jpg/jpeg): pasarlos por
`sharp().metadata()` como validación (sin recomprimir, para no degradar arte).
PDF/AI/EPS: chequear magic bytes (`%PDF`, `%!PS`). SVG: ya va con descarga
forzada, dejarlo así.

---

## 4. 🟡 `npm audit`: 4 high, pero ninguna alcanzable en runtime (MEDIA-BAJA)

**Qué**: dos vulnerabilidades distintas, las dos en herramientas de build:

| Paquete | Vía | ¿Llega al runtime? |
|---|---|---|
| `nanoid` <3.3.18 | `postcss` (build de CSS) | No — solo build |
| `deepmerge-ts` <8.0.0 | `prisma` CLI (devDependency) | No — solo CLI |

Ninguna procesa entrada de usuarios en producción. La de nanoid (la anotada
hace tiempo) se arregla gratis: `npm audit fix` la lleva a 3.3.18 sin breaking
changes. La de deepmerge-ts pide `prisma@6.12.0`, que es un **downgrade
breaking** — no hacerle caso a `audit fix --force`; se resuelve sola cuando
Prisma actualice su dependencia.

**Costo**: `npm audit fix` (solo nanoid) + verificar build. Minutos.

---

## 5. 🟡 `*.cloudfront.net` en `next/image` es un comodín demasiado ancho (MEDIA-BAJA)

**Qué**: cualquier distribución de CloudFront del mundo puede pasarse por el
optimizador de imágenes del sitio (`/_next/image?url=https://loquesea.cloudfront.net/...`).
No filtra datos, pero consume la cuota de optimización de Vercel (5K
transformaciones/mes en Hobby — el dashboard ya muestra 1.2K usadas) y hace de
proxy para contenido ajeno.

**Por qué existe**: documentado en CLAUDE.md — el id de la distribución de CDO
cambia entre entornos. Es un trade-off consciente, no un descuido; lo que
cambió es que ahora se conoce el id de producción.

**Dónde**: `next.config.ts:29`.

**Costo**: bajo. Fijar el hostname de la distribución de producción de CDO
(hoy conocido) y mover el comodín a una env var solo para desarrollo. Ojo al
verificar: un host no configurado **rompe la página entera**, no muestra una
imagen rota — probar el catálogo completo tras el cambio.

---

## 6. 🟡 El stock bruto cruza al cliente (BAJA)

**Qué**: `PurchasePanel` recibe `stock` y `reservedStock` crudos como props.
La UI solo muestra el disponible, pero ambos números viajan en el payload RSC
— visible con "ver código fuente". CLAUDE.md dice "nunca mostrar el stock
bruto"; no se muestra, pero se envía. Es información operativa del proveedor
(cuánto hay reservado) expuesta sin necesidad.

**Dónde**: `src/app/(store)/producto/[id]/page.tsx:97-98` →
`src/components/product/purchase-panel.tsx`.

**Costo**: trivial. Calcular `available` server-side y pasar un solo número.
De paso resuelve el hallazgo 10 (el helper que ya existe y nadie usa).

---

## 7. 🟡 `getQuotes` sin paginación y con datos de clientes (BAJA hoy, crece sola)

**Qué**: el listado del panel trae **todas** las cotizaciones de la base, sin
`take`. Con 7 filas da igual; con dos años de operación son miles de filas con
nombre, email y teléfono viajando enteras en cada carga del panel. No es fuga
(el panel está autenticado) pero sí es la consulta que peor envejece del
proyecto.

**Dónde**: `src/lib/admin-quotes.ts` (`getQuotes`, `getQuoteHistoryByEmail`).

**Costo**: medio (paginación de UI incluida). Alternativa barata inmediata:
`take: 200` como red de seguridad y paginar cuando duela.

---

## 8. 🟢 Calidad: hallazgos menores agrupados (BAJA)

- **Código muerto real**: `getVariantAvailableStock` (`src/lib/product.ts`) —
  cero usos. La ironía: el cálculo que encapsula (`stock - reservedStock`)
  está duplicado inline en `cotizar/actions.ts:101` y `purchase-panel.tsx:130`.
  O se usa o se borra; usarlo es mejor (ver hallazgo 6).
- **Sobre-exportación**: 10 funciones exportadas que solo se usan en su propio
  archivo (`normalizeForMatch`, `whatsappUrl`, `syncCdoProduct`, etc.).
  Cosmético; quitar `export` documenta qué es API y qué es interno.
- **Wildcards de ILIKE sin escapar**: buscar `100%` o `_` en el catálogo
  activa comodines de SQL. **No es inyección** (el `$queryRaw` va
  parametrizado con tagged template, verificado) — solo resultados raros.
  Arreglo de una línea si molesta: escapar `%` y `_` del término.
- **`getProducts` hace `include` sin `select` sobre `Product`**: las cards
  del catálogo traen la fila entera, incluida `description` (los textos de
  Zecat son largos) que la card no usa. Con 24/página no duele; es el punto
  exacto donde un `select` explícito paga, y era la regla que el proyecto ya
  se había puesto.

---

## 9. 🟢 Duplicación entre conectores: real pero estructural, no urgente

**Qué**: `zecat/sync.ts` (259 líneas) y `cdo/sync.ts` (366) comparten la forma
completa — upsert por id externo, una transacción por producto, imágenes
borradas y recreadas, parseo defensivo de stock, summary de corrida — sin
compartir una línea. El costo se paga en cada fix transversal: el lock de
concurrencia y la tabla `SyncRun` del cron de productos van a tener que
escribirse **dos veces**.

**Recomendación**: no refactorizar antes de la entrega (riesgo alto, beneficio
diferido). Hacerlo como PRIMER paso del trabajo del cron de productos, que ya
está en PENDIENTES y toca los dos conectores sí o sí.

---

## Revisado y NO es problema

- **Secretos**: cero en el repo (histórico completo revisado con
  `--diff-filter=A`: ningún `.env` se commiteó nunca), cero `NEXT_PUBLIC_*`,
  tokens de Zecat/CDO/Blob solo en `src/lib/*/client.ts` y scripts —
  server-side todo. El bundle del cliente no puede contenerlos.
- **Inyección SQL**: los dos `$queryRaw` (catálogo y panel) usan tagged
  templates — Prisma parametriza. Verificado el interpolado: es bind param,
  no concatenación.
- **Control de acceso**: las 9 pantallas del panel llaman su gate
  (`admin/(panel)/page.tsx` no, pero es un `redirect()` puro sin datos — nada
  que proteger). Las 13 Server Actions del panel: todas con
  `requireAdmin`/`requireSuperAdmin` como primera línea. El middleware corta
  sin sesión en Edge y la autorización real va contra la base por request.
  El bootstrap del primer super-admin se cierra solo con la primera fila.
- **PII en logs**: el único log del flujo de cotización registra ids de
  producto, nunca nombre/email/teléfono. Ningún endpoint público lee
  cotizaciones: `quoteId` se devuelve al enviar y no existe ruta pública que
  lo consuma.
- **`costPrice` no cruza al cliente**: la ficha enumera campo por campo lo
  que pasa a `PurchasePanel` (documentado en el código), el catálogo pasa
  el precio ya calculado. El costo y el margen no llegan al navegador.
- **Índices**: los que hay cubren las consultas reales (`categoryId`,
  `origin`, `status`, `productId` en todas las hijas). Con 854 productos,
  Postgres resuelve cualquier consulta del catálogo en memoria; el índice
  GIN para búsqueda ya está anotado en PENDIENTES con el criterio correcto
  ("cuando crezca a varios miles"). Agregar índices hoy sería culto al cargo.
- **N+1**: no hay. Las consultas compuestas (`home.ts` con picks a mano,
  catálogo con `include`, ficha) son una query por bloque. `Promise.all`
  donde corresponde.
- **Bundle**: 884KB de chunks estáticos totales (sin comprimir), dentro de lo
  normal para Next; 28 componentes cliente, todos con motivo (forms,
  interacción). Ningún import de servidor en componentes cliente — se
  verificó que Prisma/tokens no pueden llegar al bundle.
- **Subida de fotos de producto** (admin): validación de contenido real vía
  sharp — falla si el archivo no es imagen aunque la extensión mienta. Solo
  los logos de cotización quedan con el gap (hallazgo 3).

## Ya conocido, no re-reportado

El `sslmode=verify-full` pendiente y la región `iad1` vs Neon `sa-east-1` ya
están en PENDIENTES desde el log del cron. Los archivos huérfanos de Blob y el
mapeo de categorías, ídem.

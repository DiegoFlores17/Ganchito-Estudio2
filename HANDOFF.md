# HANDOFF — Estado del trabajo

Registro del estado real del proyecto para poder retomar sin reconstruir contexto.
Se actualiza al final de cada tanda de trabajo.

**Última actualización:** 2026-08-19 — tanda 8 (descubribilidad del panel)
**Branch:** `main`, todo pusheado (`de7fe3c`). Las 8 tandas están deployadas.

> La migración de `deletedAt` ya está aplicada en las dos bases, así que el
> orden seguro (migrar antes que el código) está cumplido. Antes de tocar
> cualquier base, leer "Regla de entornos" acá abajo.

> **La tanda 6 está verificada en un teléfono real** y pasó a "Terminado y
> verificado". Las tandas 2 a 5 siguen deployadas pero sin mirar: deployado
> **no es** verificado — ver "Pendiente de verificar".

> Este archivo es el estado del TRABAJO. Para el contexto de negocio y las
> decisiones cerradas, ver `CLAUDE.md`. Para el backlog largo, ver
> `PENDIENTES/pendientes.md`.

---

## Regla de entornos (leer antes de tocar cualquier base)

**Hay DOS bases distintas, con datos distintos:**

| | `.env` (local) | Vercel (Neon) |
|---|---|---|
| Host | `localhost:5432` (docker-compose) | Neon, `sa-east-1` |
| Productos | 554 (553 Zecat + 1 manual) | 554 (mismos) |
| **Cotizaciones** | **7** (de prueba) | **0** |

**El `.env` apunta SIEMPRE a local.** Producción se toca únicamente pasando
`DATABASE_URL=...` adelante del comando, y solo cuando se pide explícitamente.

**Vercel NO aplica migraciones.** No hay `vercel.json`, el build es
`next build` y el postinstall solo `prisma generate`. Cero apariciones de
`migrate deploy` / `migrate dev` / `db push` en el repo. **Neon se migra a
mano.** Consecuencia de orden: código que lea una columna nueva no puede
llegar a Vercel antes de que Neon tenga la migración, o se rompe producción.

**Antes de CUALQUIER escritura contra una base, verificar el destino en el
mismo comando que la escritura**, con una guarda que aborte:

```bash
DEST=$(npx prisma migrate status 2>&1 | rg -o 'at "[^"]+"' | head -1)
if ! echo "$DEST" | rg -q 'localhost'; then echo "ABORTADO"; exit 1; fi
npx prisma migrate deploy
```

> Esta regla existe porque pasó: se aplicó una migración contra Neon creyendo
> que iba a local. El `.env` había cambiado entre la verificación y la
> ejecución. La migración era aditiva y el daño fue nulo, pero el método
> estaba mal.

**Comandos de Prisma:** `migrate dev` **NO** — puede ofrecer resetear la base.
Para generar SQL sin tocar nada:
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
(solo lectura, sin shadow database). Para aplicar: `migrate deploy`, que nunca
ofrece resetear. En Prisma 7 los flags cambiaron: es `--from-config-datasource`,
ya no `--from-schema-datasource`.

---

## Producción

El proyecto **ya está deployado y funcionando**.

| Pieza | Dónde |
|---|---|
| App | https://ganchito-estudio2.vercel.app (Vercel) |
| Base de datos | Neon (PostgreSQL) |
| Storage de archivos | Vercel Blob |
| Repositorio | https://github.com/DiegoFlores17/Ganchito-Estudio2 |

Verificado el 2026-08-14: la home de producción carga con contenido real
(hero, categorías, proceso en 4 pasos, productos destacados con precios, footer).

**Importante para probar:** los tiempos de carga reales solo se ven en producción.
En local la base responde instantáneo y los estados de carga no aparecen nunca.
Cualquier trabajo de performance o de feedback de carga se valida en Vercel.

---

## Terminado y verificado

Construido, commiteado y visible funcionando en producción:

- **Conector de Zecat.** Sync por polling con upsert por `zecatId` / `sku`, cada
  producto en su propia transacción. Se corre a mano con `npm run sync:zecat`.
  552 productos en la base.
- **Modelo de precios.** `costPrice` de Zecat + margen global editable
  (`PricingConfig.defaultMarginPercent`, 45%), IVA siempre aparte. Validado contra
  datos reales de la API.
- **Catálogo público** (`/catalogo`): grilla, filtro por categoría, paginación
  (23 páginas), búsqueda insensible a acentos (`unaccent` + `ILIKE`).
- **Ficha de producto** (`/producto/[id]`): galería, variantes color/talle,
  información de personalización (áreas y técnicas de impresión), panel de compra
  con mínimo por producto.
- **Flujo de cotización** (`/cotizar`): carrito en localStorage, múltiples
  combinaciones color/talle en una pasada, subida de logo, envío con precio
  congelado. Sin pago online (decisión de negocio).
- **Panel de administración** (`/admin`): autenticación con Auth.js + Google OAuth,
  gestión de cotizaciones con cambio de estado, alta/baja de admins, edición del
  margen global, ABM de productos manuales con subida de imágenes.
- **Home** (`/`): hero, categorías, proceso en 4 pasos, destacados. Fase 3 de la
  pasada de diseño.
- **Storage en Vercel Blob**: `saveUploadedFile()` con `put()`. Raster inline,
  el resto (pdf/svg/ai/eps) fuerza descarga.
- **Optimización automática de imágenes** de producto al subirlas (sharp).
- **Deploy completo y verificado en producción.** Base en Neon y variables de
  entorno cargadas en Vercel; URLs de producción (orígenes + redirect URIs) en
  Google Cloud Console, con el login del panel funcionando en `/admin`; subida de
  archivos a Vercel Blob probada end-to-end (se cargó un producto con imagen desde
  el panel en producción).

  > **Gotcha del `BLOB_READ_WRITE_TOKEN`.** Vercel creó la variable con el nombre
  > autogenerado del store, no con el nombre estándar que busca `@vercel/blob`.
  > Hubo que crearla a mano como `BLOB_READ_WRITE_TOKEN`. Si se cambia de store de
  > Blob, revisar esto primero: el síntoma es que las subidas fallan por falta de
  > token aunque el store figure conectado en el dashboard.
- **Fix de la paginación del catálogo** (`f6871d9`). Verificado en producción el
  2026-08-18: entrar a `/catalogo?page=3` ya no devuelve a la página 1.
- **Skeleton del catálogo** (`b0dbcdd`). Verificado en producción: el esqueleto
  aparece al cambiar de categoría y de página.
- **Indicador de navegación del catálogo** (`03800c2`, `7adbdc5`, `bc736d7`).
  **Verificado en un teléfono real**: la fila tocada queda en violeta atenuado,
  la anterior suelta el violeta, el panel de categorías se mantiene abierto
  hasta que llega la página, y no parpadea en las navegaciones rápidas. El
  valor del keyframe (`0.45`) quedó aprobado como está.

  > Lo único de esa tanda **no** probado en dispositivo es la salida de
  > emergencia de 2s: se verificó localmente colgando `window.fetch`. Para
  > cerrarlo en un teléfono, poner modo avión justo después de tocar una
  > categoría y confirmar que el panel se cierra solo.

---

## En curso

### Estados de carga — construido entero, verificado a medias

El relevamiento está cerrado y **no queda nada por construir**. Todo pasa
`tsc --noEmit`, `eslint` y `npm run build`, y está deployado. Lo que falta es
mirarlo: de las seis tandas, solo la 6 (y el fix de paginación de la 1) están
confirmadas en producción.

**Tanda 1** (pusheada y deployada). Del deploy solo está confirmado el fix de
paginación; **los skeletons todavía no se miraron en producción**.

- `src/components/skeleton.tsx` — primitiva `<Skeleton />`. Tinte violeta de marca
  a opacidad muy baja (`bg-primary/[0.07]`) + `animate-pulse`. Sobria a propósito.
- `catalogo/loading.tsx` y `producto/[id]/loading.tsx`.
- `src/components/search-input.tsx` — `useTransition` + spinner en el input.
  Cubre `/catalogo` y `/admin/productos` de una.

**Tanda 2** (commiteada, **sin pushear**).

- `admin-skeletons.tsx` (tabla + formulario compartidos) y `quote-skeleton.tsx`.
- `loading.tsx` en `/cotizar` y en las siete pantallas del panel.
- Home: en vez de `loading.tsx`, `Suspense` por sección — ver la nota de abajo.
- `product-card-image.tsx` — shimmer del catálogo (opción A, decidida).
- Feedback de acciones: login del admin, filtro de cotizaciones, team-management,
  toggle-active, product-form.

**Tanda 3** (commiteada, **sin pushear**).

- Revalidación de la home — ver la sección dedicada más abajo.
- `error.tsx` en tres niveles: `(store)/error.tsx` (cara al cliente, con marca),
  `admin/(panel)/error.tsx` (más seca, la ve el equipo) y `global-error.tsx`
  (último recurso, con estilos inline porque reemplaza el layout raíz y no puede
  asumir que cargó la hoja de estilos). Las tres muestran `error.digest`, que es
  el mismo identificador que queda en los logs del servidor.
  **Usan `retry()`, no `reset()`**: `reset()` limpia el boundary sin volver a
  pedir los datos, así que ante una base caída re-renderizaría el mismo error.
  `retry` es estable desde Next 16.3, justo la versión del proyecto.

| | Antes | Ahora |
|---|---|---|
| `loading.tsx` | 0 | 9 |
| `error.tsx` | 0 | 3 (tienda, panel, global) |
| Skeletons / `animate-pulse` | 0 | primitiva + piezas compartidas |
| `placeholder="blur"` | 0 | n/a — resuelto con shimmer (opción A) |

Con esto **el relevamiento queda cerrado**: los cuatro frentes cubiertos.

**Tanda 4** — pantallas faltantes y arreglos de las de error.

- `6b79b00` — los tres error boundaries pasaban `onClick={retry}` a secas, con
  lo cual React le entregaba el evento de click a una función `() => void`.
  TypeScript no lo marca (una función sin parámetros es asignable a una que
  recibe uno), así que pasaba silencioso. Corregido a `onClick={() => retry()}`
  en los tres, más tildes en el texto visible.
- `663104f` — `(store)/not-found.tsx`. Cubre las llamadas a `notFound()` dentro
  de la tienda (hoy `/producto/[id]`), con header y footer.
- `ab19df2` — `app/not-found.tsx` raíz, para las URLs que no matchean ninguna
  ruta. **Sin** header ni footer, a propósito: este archivo atiende también las
  URLs sueltas de `/admin`, y el `Header` arrastra `CartIndicator` y
  `MobileNav` (JS del carrito en una pantalla de error). A diferencia de
  `global-error.tsx`, este **sí** se renderiza dentro del layout raíz, así que
  usa Tailwind y los tokens con normalidad.
- `50cc2c0` — `<title>` en `global-error.tsx`. Los error boundaries son client
  components y ahí no funcionan los exports de `metadata`; la doc señala el
  `<title>` de React como alternativa.
- `7a2056b` — sacar del nav `/como-funciona` y `/contacto`: **nunca existieron
  como rutas**. Eran dos links al 404 en el header de todas las páginas, y en
  las dos versiones del nav, porque `NAV_LINKS` alimenta también al `MobileNav`.

**Tanda 5** — ancla del nav y ortografía.

- `f208d63` — "Cómo funciona" vuelve al nav como ancla `/#como-funciona`. El
  contenido ya existía como sección de la home; se le agregó el `id` y un
  `scroll-mt-8`. **Verificado en el navegador** desde `/catalogo` y desde
  `/producto/[id]`: la URL pasa a `/#como-funciona` y el scroll salta a 1575
  con la sección a 32px del borde. Navega **y** scrollea, no solo cambia el
  hash. "Contacto" no vuelve: ya está en el footer y competiría con el CTA.
- `76efe7f` y `c459c18` — tildes en toda la UI, primero la tienda y después el
  panel. No era una decisión de estilo: `printing-info.tsx` ya usaba
  "Personalización" y "Áreas de impresión", así que era deuda. Se agregaron
  también los signos de apertura (`¿Listo para vestir tu marca?`) y las formas
  de voseo ("Explorá", "Recorré", "Elegí", "Podés", "Llevás", "Escribí").
  No se tocaron URLs, slugs, nombres de parámetros, identificadores ni
  comentarios: el searchParam sigue siendo `categoria` sin tilde.

**Tanda 6** — el hueco anterior al skeleton.

Confirmado en producción que el `loading.tsx` de `/catalogo` funciona: el
esqueleto aparece al cambiar de categoría y de página. Lo que quedaba
descubierto era el **instante anterior**: entre el toque y el esqueleto la
pantalla vieja se queda quieta, y en mobile eso puede durar segundos.

- `03800c2` — refactor puro, sin cambio visual. El aspecto de los controles
  (fondo del chip, círculo del número de página) vivía sobre el propio
  `<Link>`; se muda a un `<span>` hijo en `link-content.tsx`. Era condición
  necesaria: `useLinkStatus` solo puede llamarse desde un **descendiente** del
  `Link`, y un hijo no puede estilar a su padre.
- `7adbdc5` — el control tocado se atenúa mientras navega, vía `useLinkStatus`.
  Solo opacidad: sin cambio de tamaño ni posición, así que no hay layout shift.

**El retardo de 120ms no es un detalle.** Sin él, *cada* navegación rápida
tiraba un parpadeo del control. El keyframe `navegando` de `globals.css`
arranca invisible y solo aparece si la cosa de verdad tarda. Medido:
50ms → 1.00, 110ms → 1.00, 200ms → 0.69, 400ms → 0.45. Respeta
`prefers-reduced-motion`.

**No se usa `prefetch={false}`**, aunque la doc diga que el hook "es más útil"
así. Apagar el prefetch haría lento *siempre* lo que hoy es rápido, y el hueco
que se tapa es justamente cuando el prefetch **no** llegó a completarse — que
es por qué el síntoma aparece en mobile y no en desktop.

### El panel de categorías de mobile ya no se cierra en el toque

Era el peor caso y era el de mobile: al tocar una categoría el panel se cerraba
al instante, o sea que **el único control capaz de devolver una señal
desaparecía de la pantalla en el mismo momento del toque**, y el usuario
quedaba mirando el catálogo viejo sin ningún cambio.

Ahora se cierra cuando la navegación **llega**. Cómo se detecta, que es lo no
obvio: `activeSlug` es una prop que manda el server con los searchParams
nuevos, así que alcanza con comparar `pendingSlug` contra ella y ajustar el
estado **durante el render**. Nada de efectos ni de callbacks del hijo hacia
arriba — eso último habría requerido un `setState` dentro de un `useEffect`,
que es el anti-patrón que el linter ya marcó en `team-management.tsx`.

**Salida de emergencia (`PANEL_SALIDA_MS`, 2s):** si la navegación nunca
termina, el panel se cierra igual. El `setState` va dentro del callback del
timeout, no sincrónico en el efecto, por eso pasa el lint. El botón de cerrar
**nunca** se deshabilita.

> Ojo: el panel es `fixed inset-0` con fondo opaco, ocupa la pantalla entera.
> **No hay backdrop clickeable**, la salida es el botón de cerrar. Si se quiere
> Escape o un backdrop real, es trabajo aparte.

Verificado en el navegador con el dev server:

| Prueba | Resultado |
|---|---|
| Chip tocado en desktop | Se marca **uno solo**, el cliqueado |
| Panel mobile al tocar | 1ms: abierto · 106ms: fila marcada · 196ms: cerrado con URL nueva |
| Red colgada (`window.fetch` anulado) | Abierto y marcado a 279/992/1787ms · **cerrado a 2037ms** |
| Cerrar durante pending colgado | Botón habilitado, se pudo salir |

### Tanda 8 — que se note dónde se puede clickear (`de7fe3c`)

Mismo problema que había en productos, ahora en `/admin/cotizaciones`: el
detalle existía y se llegaba clickeando el nombre, pero no había cómo notarlo.
Los links estaban escondidos en la fecha y el nombre del cliente, que se
renderizan igual que texto común, y **solo 2 de las 6 celdas eran
clickeables** — la fila parecía clickeable y no lo era según dónde le pegaras.

Ahora la fila entera navega (cursor de link + hover) y hay una columna con un
**"Ver"** visible que hace de señal. Verificado en producción: el click anda.

**La decisión no obvia, para no deshacerla sin querer:** el click en la fila
**no navega por su cuenta, dispara el `<Link>` del "Ver"**. `useLinkStatus`
solo funciona dentro del `Link`, así que si la fila llamara a `router.push`
por separado habría dos caminos de navegación y el botón no se enteraría
cuando entrás clickeando la fila — el estado de carga aparecería solo a veces.

- El botón muestra "Abriendo..." con `min-width` fijo (que no ensanche la
  celda) y `pointer-events-none`, que es lo que de verdad evita el segundo
  click: un `<a>` no se puede deshabilitar.
- Se sacaron los links de fecha y nombre: con la fila clickeable eran
  elementos interactivos anidados sin aporte. Queda **un control real por
  fila**, que además es el que se puede tabular y abrir en pestaña nueva. El
  click en la fila es comodidad para mouse, no el mecanismo.

**Auditoría de las otras tablas del panel:**

- **Equipo** — no tiene el problema. No existe pantalla de detalle de un
  admin, así que no hay nada oculto. Su única acción ("Sacar") ya es visible.
- **Productos** — resuelto en la tanda 7 con el botón "Editar". **La fila NO se
  hizo clickeable, a propósito:** esa tabla tiene *dos* acciones por fila
  (Editar y Pausar), así que un click a nivel de fila se dispararía cada vez
  que alguien apunte a "Pausar" y le erre por unos píxeles. Cotizaciones no
  tiene ese conflicto porque no tiene acciones en la fila. Si algún día se
  quiere igual, el `closest("a, button")` del handler ya lo contempla.

### Tanda 7 — editar y eliminar productos manuales

Nueve commits, `f0e2801` → `89f51c2`. Pusheada y deployada.
**Verificada en local, pendiente de verificar en producción.**

#### Verificación en local: 20/20

Se armó el escenario que la base no tenía —un producto manual **dentro de una
cotización**, hoy hay cero— y se corrió contra las funciones reales del
proyecto, no contra una réplica:

| Prueba | Resultado |
|---|---|
| Editar | nombre, costo y `minOrderQuantity` persisten y se releen |
| Antes de eliminar | visible en búsqueda pública, ficha, grilla admin y guard |
| Guard de origin | un producto de Zecat **es rechazado** |
| Después de eliminar | filtrado de las cuatro, incluida la búsqueda por SQL crudo |
| Soft delete | la fila **no se borró**, `deletedAt` seteado, `active` en false |
| Cotización histórica | conserva el ítem, **lee el nombre del producto**, precio congelado intacto |
| FK | el `delete` real **sigue bloqueado**: Prisma devolvió `P2003` |

> Lo del `P2003` importa más de lo que parece: el bloqueo de la FK era la
> premisa que justificaba toda la baja lógica, y hasta acá era una lectura del
> SQL de la migración inicial. Ahora está comprobado ejecutándolo.

**El flujo por la interfaz también quedó probado**, y no por la suite: en la
base local hay un `"Buzo Canguro Premium TEST"` (manual, creado el 2026-08-18,
`deletedAt` el 2026-08-19) que se eliminó desde el panel. Quedó con
`active: false`, fuera de la grilla del admin, con 0 resultados en la búsqueda
pública y la ficha devolviendo null. **No borrar esa fila**: es el registro de
esa prueba.

> **Trampa del entorno, para no perder tiempo la próxima:** el dev server de
> `localhost:3000` dejó de hidratar después de ~15 commits y una regeneración
> del cliente de Prisma — los botones no responden, y **no es culpa del código**
> (se comprobó con `+ Agregar variante`, que es preexistente y tampoco anda).
> Se arregla reiniciando el dev server. Levantar el build de producción en otro
> puerto **no** sirve como alternativa para el panel: la cookie de sesión no
> cruza de puerto y hay que loguearse de nuevo.

**Por qué la eliminación es baja lógica y no borrado real** (esto es lo que
decide el diseño, conviene no reabrirlo sin releerlo): `QuoteItem` referencia
al producto por FK con `ON DELETE RESTRICT` — verificado en el SQL de la
migración inicial, no supuesto — y el detalle de cotización lee
`item.product.name`. **El nombre no se copia al cotizar; solo el precio se
congela.** Un `delete` real quedaría bloqueado por la base, y forzarlo con
`CASCADE` destruiría las líneas de cotizaciones históricas.

**Por qué un campo nuevo y no reusar `active`:** `active` significa "pausado",
un estado reversible que el admin ve y puede volver a prender. Si eliminar
fuera `active = false`, "Pausar" y "Eliminar" serían el mismo botón con dos
nombres.

Los commits, en orden:

- `f0e2801` — **bug preexistente**: `saveProduct` no verificaba el `origin`.
  Mandando el id de un producto de Zecat, el update lo escribía con
  `origin: MANUAL`, le borraba y recreaba las variantes, y lo dejaba con su
  `zecatId` intacto — el próximo sync lo volvía a pisar por esa clave, ya con
  las variantes destruidas. `toggleProductActive` **sí** lo verificaba: el
  chequeo estaba copiado y una de las dos se lo olvidó. Ahora es
  `findManualProductForWrite()`, compartido por las tres acciones.
- `a00412f` — columna `deletedAt` + migración.
- `dc92ed2` — acción `deleteProduct`: marca `deletedAt` **y** apaga `active`.
- `341d17c` — UI de eliminar, en la pantalla de edición y no en la grilla, con
  confirmación en dos pasos. El aviso trae el `_count` real de cotizaciones.
- `98d6530` — filtros `deletedAt` en todas las consultas, **incluidos los dos
  `$queryRaw`** (búsqueda del catálogo público y del panel), que son los que
  se olvidan.
- `ef0c999` — `toggleProductActive` no revalidaba `/producto/{id}`.
- `846f731` — `minOrderQuantity` editable. Existía en el modelo y lo escribía
  el conector, pero no era editable: todo producto manual quedaba sin mínimo,
  aunque el campo gobierna el piso de cantidad del panel de compra y la
  validación de `/cotizar`.
- `1df9720` — **la pantalla de editar no tenía cómo llegarse**: el único camino
  era el nombre del producto en la grilla, que se ve igual que texto común.

> **Hueco conocido:** un producto eliminado desaparece del panel para siempre.
> No hay pantalla de "eliminados" ni forma de restaurarlo desde la interfaz —
> hay que poner `deletedAt = NULL` a mano en la base. Es deliberado (mantiene
> el panel simple), pero si se elimina algo por error, hoy no hay camino de
> vuelta.

### Corrección posterior: el violeta apuntaba al lugar equivocado (`bc736d7`)

Al probarlo en el teléfono aparecieron dos problemas, los dos del mismo origen:
el rol de activo se decidía con `activeSlug` / `currentPage`, o sea con el
destino **viejo**.

1. La fila en pending quedaba gris **más claro** que las filas neutras: se leía
   como deshabilitada, y era el único ítem de la lista que se destacaba hacia
   abajo.
2. Peor: la categoría **anterior** seguía en violeta durante toda la espera. La
   señal más fuerte de la pantalla apuntaba a la que el usuario acababa de
   abandonar.

Ahora el rol sale de un solo valor: `(pendingSlug ?? activeSlug)` y
`(pendingPage ?? currentPage)`. La tocada lo toma, la anterior lo suelta.

**Por qué el color no necesita retardo y la opacidad sí** (esto se razonó mal
la primera vez y conviene dejarlo escrito): el color **no** es un indicador
temporal, es el estado final adelantado. Cuando llega la página, el control ya
está donde tiene que estar — no hay nada que revertir, así que tampoco hay
parpadeo posible. La opacidad es lo único que sí revertiría si la navegación
fallara, y por eso es lo único que espera 120ms.

Detalles que conviene no deshacer:

- La ventana de páginas se calcula con `currentPage`, **no** con la optimista:
  recalcularla con la tocada reordenaría los números debajo del dedo antes de
  que la página exista.
- `Pagination` pasó a client component y los hooks van **antes** del
  `if (totalPages <= 1) return null`.
- Tiene el mismo tope de 2s que el panel: un número mintiendo que es la página
  actual es peor que no tener indicador.

El único indicador que existía antes de todo esto era una línea de texto en
`/cotizar` ("Cargando tu cotizacion...").

**Decisiones tomadas durante la implementación** (las cuatro importan si se
retoma esto de cero):

**1. Imágenes: opción A, shimmer.** `placeholder="blur"` con imágenes remotas
exige un `blurDataURL` generado a mano (Next solo lo genera automático con
imports estáticos). Las de Zecat se borran y recrean en cada sync, así que
implicaría descargar 552 imágenes por corrida para un efecto visual. Se
descartó. Si más adelante se quiere blur real, se suma **solo para productos
manuales**, donde sharp ya corre al subir.

**2. El gate del panel se queda bloqueando.** La doc de Next 16.3
(`docs/.../loading.md:88` y `layout.md:316`) dice que si un layout accede a datos
sin cachear, el `loading.tsx` de ese segmento no muestra fallback, y recomienda
sacar el acceso del layout o envolverlo en `Suspense`. **Aplicado a
`requireAdmin()` eso habría sido un agujero de autorización**: el contenido del
panel empezaría a transmitirse antes de resolver el chequeo. Ver la sección del
fix más abajo. La solución fue al revés: la barrera se queda bloqueando en el
layout, y cada page se autoriza a sí misma — esa llamada sí cae dentro del
`Suspense` que abre `loading.tsx`.

**3. La home usa `Suspense` por sección, no `loading.tsx` de ruta.** Tres de sus
cinco secciones son texto fijo; un fallback de ruta las taparía con gris sin
motivo.

**4. Estética:** paleta de marca según `DISENO/DISENO.md`, sobrio, sin
animaciones estridentes. El riesgo a evitar es una interfaz que parpadee por
todos lados.

### Resuelto: la home mostraba precios desfasados

**El problema.** `/` se prerenderizaba estática sin revalidación: destacados y
precios quedaban congelados al build. `/catalogo` es dinámica y siempre fresca,
así que el mismo producto podía aparecer con **dos precios distintos** según por
dónde entrara el cliente. (Verificado que la home ya era estática *antes* de la
refactorización con `Suspense` — no fue una regresión de la tanda 2.)

**La causa de fondo** no era solo que la ruta fuera estática: el proyecto ya
revalida a demanda desde las Server Actions, pero `"/"` no estaba en **ninguna**
de esas listas. Cambiar el margen global invalidaba `/catalogo` y no la portada.

**La solución** (`46120d8`), decidida con el usuario:

- `revalidatePath("/")` agregado donde ya revalidaban `/catalogo`
  (`configuracion/actions.ts`, `productos/actions.ts` ×2). Los cambios hechos
  desde el panel impactan **al instante** y sin costo por visita.
- `export const revalidate = 300` en la home, para el único camino que no puede
  invalidar solo: el sync de Zecat corre como script suelto, fuera del runtime de
  Next, y no tiene forma de llamar a `revalidatePath`.

Se descartó `force-dynamic`: cobraría tres consultas a Neon en cada visita de la
página más visitada para resolver algo que el resto del tiempo ya se resuelve
gratis con la invalidación a demanda.

> El build lo confirma: `/` ahora aparece con `Revalidate 5m`.

**Pendiente asociado:** si el sync pasa a Vercel Cron, conviene darle un endpoint
de revalidación con secreto y bajar `revalidate` a `false` — ahí la ventana de
tiempo deja de hacer falta.

### Bug corregido: la paginación del catálogo se reseteaba sola

Apareció al meterle `useTransition` a `SearchInput` y **se confirmó reproduciéndolo
en producción** antes de tocar nada.

**Síntoma:** entrar a `/catalogo?page=3` (o clickear cualquier página) devolvía al
cliente a la página 1 unos 350ms después, sin que él hiciera nada.

**Causa:** el `useEffect` de debounce de `src/components/search-input.tsx` también
corre en el montaje. Al montarse, reconstruía la query desde cero usando solo
`extraParams` + `q` — y `page` no está en ninguno de los dos, así que lo borraba y
hacía `router.replace` a la URL sin paginar.

**Evidencia:** navegando a `/catalogo?categoria=drinkware&page=4` en producción, la
URL queda en `/catalogo?categoria=drinkware`. `categoria` sobrevive (está en
`extraParams`), `page` desaparece. Coincide exactamente con el mecanismo descrito.

**Fix:** un `skipNextRef` que saltea la primera corrida del efecto. Solo se navega
cuando el valor tipeado cambia de verdad. Sin esto, además, el spinner nuevo se
encendía solo en cada carga de página.

**Verificado en producción el 2026-08-18:** `/catalogo?page=3` conserva el `page`.

### Fix de autorización: el panel dependía solo del layout

`/admin/cotizaciones` y `/admin/productos` **no llamaban a `requireAdmin()`**: su
única barrera era la del layout. El middleware no sirve de respaldo porque corre
en Edge y solo puede ver si existe una sesión de Google válida — no puede
consultar `AdminUser` ni el rol.

Apareció al planificar los `loading.tsx` del panel: seguir la recomendación
genérica de la doc (sacar el acceso a datos del layout o envolverlo en
`Suspense`) habría dejado que esas dos pantallas empiecen a transmitir su
contenido antes de resolver el chequeo, filtrando cotizaciones y productos a
cualquiera con una cuenta de Google.

**Fix** (`1278e4c`): cada page del panel se autoriza a sí misma, y el layout
mantiene su barrera bloqueante. `requireAdmin()` / `requireSuperAdmin()` quedan
envueltas en `cache()` de React para que layout y page no disparen dos consultas
idénticas por navegación (el cache es por request, no debilita el chequeo).

---

## Pendiente de verificar

Cosas construidas cuyo funcionamiento en producción todavía no se confirmó:

- **Sync de Zecat contra la base de producción.** El script se corre a mano y
  apunta a la `DATABASE_URL` del entorno. Confirmar que los 552 productos de
  producción están actualizados y que el sync se puede correr contra Neon.
- **Subida del logo del cliente en una cotización real.** La subida a Blob quedó
  verificada por el lado del admin (foto de producto), pero no hay registro de una
  prueba del otro uso: un cliente subiendo su logo en `/cotizar` en producción.
- **Token de Zecat: preprod o producción.** Sigue sin confirmarse a cuál apunta
  `ZECAT_API_URL`.
- **Los skeletons de la tanda 1, en producción.** Están deployados, pero nadie
  confirmó todavía haberlos visto. Mirar `/catalogo` y `/producto/[id]` en Vercel
  con latencia real.
- **Las pantallas de error** (tanda 3). Nunca se dispararon. Para verlas hay que
  forzar un fallo: apuntar `DATABASE_URL` a una base inexistente en un preview.
- **La revalidación de la home** (tanda 3). Confirmar que al cambiar el margen
  desde el panel, la portada refleja el precio nuevo enseguida.
- **Tandas 2 a 5.** Pasan typecheck, lint y build. Las 2 y 3 están deployadas;
  nadie miró nada en producción todavía. Al verificar, mirar como mínimo:
  - Que el panel siga entrando bien (se tocó la autorización).
  - Que los skeletons del admin aparezcan al navegar **entre** pantallas del
    panel. Al entrar por primera vez el layout bloquea por el chequeo de
    autorización — eso es correcto y esperado, no un bug.
  - El shimmer del catálogo, con especial atención a las fotos ya cacheadas
    (recargar dos veces): si alguna queda invisible, falló el chequeo de
    `.complete` de `product-card-image.tsx`.
  - El filtro de `/admin/cotizaciones`, que pasó de recarga completa a navegación
    del router.
  - El ancla "Cómo funciona" del header, desde una ruta que no sea la home.
    Verificada en local; en producción la home se sirve cacheada, así que
    conviene confirmar que el destino existe en el HTML servido.
  - **La salida de emergencia de 2s, en un teléfono.** El resto de la tanda 6 ya
    está verificado en dispositivo; esto no. Modo avión justo después de tocar
    una categoría: el panel tiene que cerrarse solo en vez de quedar trabado.
  - Que no haya quedado ningún texto sin tilde ni, peor, alguna URL rota por la
    pasada de ortografía. El commit no tocó URLs ni slugs, pero se revisa.

> Nota: `next dev` reescribe solo el bloque `nextjs-agent-rules` de `CLAUDE.md`.
> Si vuelve a aparecer como cambio sin commitear, es eso — se commitea junto con
> el trabajo y listo, borrarlo del diff solo lo regenera.

---

## Próximo paso concreto

**Verificar en producción**, con la lista de "Pendiente de verificar" en la
mano. Está todo deployado; no queda nada por construir ni por pushear.

De la **tanda 7**: editar un producto manual, eliminarlo, y confirmar que
desaparece del catálogo público y del admin pero la cotización que lo tenía se
sigue viendo bien. Ojo que **producción no tiene cotizaciones**, así que para
probar ese último punto hay que crear una primero desde `/cotizar`.

De las **tandas 2 a 5**: skeletons del panel, shimmer del catálogo, filtro de
cotizaciones, pantallas de error y la revalidación de la home.

De la **tanda 8**: que el "Ver" muestre **"Abriendo..."** al clickear (solo se
nota si la navegación tarda algo; el detalle es dinámico, así que debería), y
que el segundo click no haga nada mientras tanto. Ya está todo deployado. En local no hay latencia: los
estados de carga no se ven nunca, así que mirarlo en Vercel —y en un teléfono
real, no en el navegador angostado— es lo único que valida el trabajo.

La tanda 6 ya está cerrada: se probó en un teléfono y quedó aprobada.

Con el relevamiento cerrado, **no queda nada pendiente de construir en el tema
estados de carga**. Lo que sigue es verificar y decidir.

Para probar las pantallas de error hace falta forzar un fallo — lo más simple es
apuntar `DATABASE_URL` a una base inexistente en un preview de Vercel.

Lo que queda abierto:

- **`notFound()` que hoy no se llama** (relevado, no cambiado — es decisión de
  producto):
  - `/catalogo?categoria=basura` devuelve **200** con la grilla vacía y "No hay
    productos en esta categoría". Como es searchParam y no segmento de ruta, el
    empty state es defendible en UX; para SEO, un 200 con contenido vacío no es
    ideal.
  - `/catalogo?page=9999` — mismo caso.
  - Los tres `notFound()` que sí existen (`producto/[id]`, `admin/productos/[id]`,
    `admin/cotizaciones/[id]`) están bien puestos. No hay lookup por slug en
    ningún lado: el producto se busca por id.

Después, la Home vuelve a la cola: quedó pendiente sumarle un bloque de logos de
marcas clientes (falta conseguir los logos).

---

## Mantenimiento de este archivo

Al terminar cada tanda de trabajo, actualizar:

- La fecha y el commit de referencia del encabezado.
- Mover lo que se completó de "En curso" a "Terminado y verificado" — solo si se
  verificó de verdad, no solo si se escribió el código.
- Sumar a "Pendiente de verificar" lo que quedó construido sin probar.
- Reescribir "Próximo paso concreto" para que quien retome sepa exactamente
  dónde arrancar.

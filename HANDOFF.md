# HANDOFF — Estado del trabajo

Registro del estado real del proyecto para poder retomar sin reconstruir contexto.
Se actualiza al final de cada tanda de trabajo.

**Última actualización:** 2026-08-21 — visibilidad de categorías
**Branch:** `main`. Las tandas 1-8 y el precio por variante están pusheados,
deployados y **verificados en producción**.

**El conector de CDO está pusheado, migrado y verificado en producción.** El
2026-08-21 se pushearon los 7 commits (`aff3ed9` → `ba9f7d7`), se aplicó
`20260821174829_add_cdo_provider` en Neon con `migrate deploy` ("All
migrations have been successfully applied") y se confirmó que el catálogo de
producción funciona.

**Todo pusheado y Neon al día.** El trabajo de categorías (visibilidad +
unificación) se subió el 2026-08-25, con las dos migraciones aplicadas en Neon
ANTES del push y producción verificada en el medio.

El conector de CDO corre contra el entorno de **pruebas** de CDO y la base
**local**, que es donde se pidió construirlo.

> Antes de tocar cualquier base, leer "Regla de entornos" acá abajo.

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

**Tanda 2** (pusheada y deployada).

- `admin-skeletons.tsx` (tabla + formulario compartidos) y `quote-skeleton.tsx`.
- `loading.tsx` en `/cotizar` y en las siete pantallas del panel.
- Home: en vez de `loading.tsx`, `Suspense` por sección — ver la nota de abajo.
- `product-card-image.tsx` — shimmer del catálogo (opción A, decidida).
- Feedback de acciones: login del admin, filtro de cotizaciones, team-management,
  toggle-active, product-form.

**Tanda 3** (pusheada y deployada).

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
- **`ProductAttribute` no se muestra en ningún lado.** El sync de CDO lo
  escribe, pero no hay UI que lo lea. Decidir si va en la ficha (junto a las
  técnicas de impresión) o si se descarta.
- **El estado real de migraciones de Neon.** La de CDO se confirmó aplicada; la
  de categorías todavía no se aplicó. Para verlo con certeza en vez de deducir
  —la URL de Neon no está en el `.env`, a propósito, así que va a mano—:

  ```bash
  DATABASE_URL='<url-de-neon>' npx prisma migrate status
  ```

  Es solo lectura. Tiene que decir que faltan **dos**:
  `20260821200000_add_category_visible` y `20260821210000_add_category_canonical`.
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

## Neon: al día

Neon tiene **todas** las migraciones del repo. Las dos últimas
—`20260821200000_add_category_visible` y
`20260821210000_add_category_canonical`— se aplicaron el 2026-08-25 con
`migrate deploy`, en ese orden y **antes** del push.

Las dos son aditivas, sin backfill y reversibles (`DROP COLUMN`). No cambiaron
nada de lo visible: `visible` arranca en `true` para todas y `canonicalId` en
`NULL`, así que ninguna categoría es alias de otra hasta que se decida desde
el panel.

**Verificado entre la migración y el push:** el catálogo de producción sigue
con sus 553 productos y precios correctos, y la home carga entera.

### Por qué el orden importa, con el caso concreto

Vale la pena dejarlo escrito porque es contraintuitivo: **una consulta de
Prisma sin `select` pide TODAS las columnas escalares del modelo.**

`getCategories()` era `prisma.category.findMany({ orderBy })`, sin `select`.
Con el schema nuevo eso incluye `cdoCategoryId`. Si el código hubiera llegado
a Vercel antes que la migración, `/catalogo` habría roto —no por leer
explícitamente una columna nueva, que nadie hacía, sino por no acotar el
select. **No alcanza con revisar qué campos usa el código a mano.**

> **Importar el catálogo de CDO a producción es un paso APARTE.** El código
> pusheado no trae productos: Vercel no tiene `CDO_API_TOKEN` ni
> `CDO_API_URL`, y el sync se corre a mano. Producción sigue con los 553 de
> Zecat.

---

## Neon: el precio por variante ya está migrado y verificado

Las dos migraciones del precio por variante —`20260821140603_add_variant_cost_price_and_usd_rate`
(aditiva, con backfill) y `20260821142204_drop_product_cost_price`— **ya están
aplicadas en Neon**, en ese orden y antes del push.

Verificado en producción por el usuario: el campo de cotización carga, el
precio cambia según la variante elegida en la ficha, y la cotización congela
el precio de **esa** variante. El margen quedó de vuelta en 45.

---

## Categorías: visibilidad y unificación — construido y verificado en local

Dos campos y una pantalla, que resuelven **dos problemas distintos**:

- **`Category.visible`** (bool, default true) → el ruido: campañas, ofertas y
  cosas que no son categorías. Se ocultan del filtro.
- **`Category.canonicalId`** (FK a sí misma) → las duplicadas entre
  proveedores. Se unifican bajo una categoría propia.

La pantalla `/admin/categorias` muestra el origen de cada una, cuántos
productos tiene, qué categorías propias existen, qué alias les apuntan y
cuántos productos suman en total.

### La premisa del pedido era incorrecta, y conviene saberlo

El pedido decía "los productos de una categoría oculta siguen apareciendo
porque un producto está en varias categorías". **La primera mitad es cierta;
la segunda no.**

`Product.categoryId` es una FK **simple y nullable**: un producto pertenece a
**una sola** categoría. Los dos conectores toman la primera que manda el
proveedor —Zecat `families[0]`, CDO `categories[0]`— y descartan el resto. La
API de Zecat sí devuelve varias familias por producto; nuestro schema no las
guarda.

**Consecuencia real, más fuerte que la que se esperaba:** ocultar una
categoría deja a sus productos **sin ninguna vía de filtro**. Siguen en la
grilla y en la búsqueda (que es lo que se pidió y funciona), pero no hay otra
categoría que los recoja.

Con números de la base local: ocultar "Próximos Arribos" (69) y "Logo 24hs"
(76) dejaría **145 productos de 761 sin forma de llegar por filtro**. Es
defendible —son productos que igual aparecen navegando y buscando— pero es
una decisión distinta a la que sugería la premisa.

> Si algún día se quiere que un producto esté en varias categorías, es un
> cambio de schema (tabla intermedia) y de los dos conectores. No está hecho
> ni planteado.

### Lo que la pantalla muestra

Las 39 categorías ordenadas **por nombre, no por origen**, a propósito: los
dos proveedores traen categorías homónimas —**"Escritura" (Zecat 26 · CDO
38), "Llaveros" (24 · 9), "Paraguas" (7 · 5), "Tecnología" (22 · 15)**— y
ordenar por nombre las deja pegadas, que es justo lo que hay que ver para
decidir.

> **Ese es un problema que hoy ya está en producción de cara al cliente:** el
> filtro del catálogo muestra dos "Escritura" y no hay forma de distinguirlas.
> Es más grave que el ruido de las campañas, y esta pantalla es lo que permite
> resolverlo (ocultando una de las dos).

Candidatos a ocultar, de la base local:

| Tipo | Categorías |
|---|---|
| Campañas | "2026 Agro" (16), "2026 Día de la Niñez" (1), "2026 Minería" (2), "2026 Novedades" (2), "2026 Reingresos" (3) |
| Ofertas | "70%OFF Bolsos y Mochilas" (**0 productos**), "70%OFF Hogar y Tiempo Libre" (1), "Ofertas" CDO (1) |
| No son categorías | "Próximos Arribos" (69), "Logo 24hs" (76) |
| Duplicadas | Escritura, Llaveros, Paraguas, Tecnología (elegir una de cada par) |

### La trampa que se evitó

`getCategories()` la usaban **tres** pantallas: el filtro público y los **dos
formularios de producto del panel**. Meterle `where: { visible: true }` habría
hecho que un producto manual asignado a una categoría oculta **perdiera su
categoría al editarlo, en silencio**. Por eso se partió en dos funciones con
nombres explícitos:

- `getVisibleCategories()` → filtro público.
- `getAllCategories()` → formularios del panel.

Ya no existe `getCategories()`: el nombre ambiguo se eliminó a propósito, para
que nadie elija mal por descuido.

### Decisiones que conviene no deshacer

- **Un link directo `/catalogo?categoria={slug}` sigue funcionando aunque la
  categoría esté oculta.** Solo desaparece del selector. Es deliberado: los
  seis tiles de la home (`HOME_CATEGORY_PICKS`) apuntan a categorías por slug,
  y si ocultar una rompiera el link, la portada quedaría con tiles muertos.
- **`visible` default true.** Una categoría nueva del proveedor aparece hasta
  que alguien decida lo contrario. Al revés, un proveedor nuevo entraría
  entero invisible y nadie se enteraría.
- **El conteo de productos excluye pausados y eliminados.** El número está
  para decidir si vale la pena ofrecer la categoría como filtro; una con 0
  productos vivos no le sirve a nadie (hoy: "70%OFF Bolsos y Mochilas").
- **Alcanza con `requireAdmin()`, no super admin.** No toca precios ni
  productos y es reversible de un click.

### Unificación de homónimas (`canonicalId`)

Ocultar resuelve el ruido (campañas, ofertas), pero **no** resuelve las
duplicadas: sacar una del filtro deja a sus productos sin ninguna vía de
filtro. Para eso está `Category.canonicalId`.

- `canonicalId = null` → la categoría es ella misma.
- `canonicalId = X` → es **alias** de X: no aparece en el filtro, y sus
  productos se muestran bajo X.

**La canónica es siempre una categoría PROPIA**, creada a mano desde el panel.
Dos razones, y las dos importan:

- **Técnica:** si la canónica fuera de un proveedor, un sync puede renombrarla
  y cambia el filtro público solo. Zecat ya mostró que estructuran los datos
  como quieren — el nombre de la familia viene en `description`, no en `name`.
- **De negocio:** las categorías de la tienda son nuestras. Podemos querer
  "Lapiceras y escritura" porque así lo buscan los clientes, aunque los dos
  proveedores le digan "Escritura".

**Por qué vive en la base y no en el conector:** los conectores escriben
`categoryId` en **cada** upsert de **cada** corrida. Reasignar productos a
mano, o borrar la categoría duplicada, dura hasta el próximo sync. Esta
columna no la toca ningún conector.

**El panel sugiere, nunca aplica.** Agrupa por nombre normalizado y ofrece
unificar con un nombre editable. No se automatiza porque el matcheo por nombre
falla callado en los dos sentidos, y los contraejemplos ya están en los datos:
"Escritorio" (22) y "Escritura" (26) se parecen y son distintas; "Hogar" (CDO,
24) y "Hogar y Tiempo Libre" (Zecat, 26) son lo mismo y no matchean.

Los cuatro pares que detecta hoy:

| Par | Zecat | CDO | Total unificado |
|---|---|---|---|
| Escritura | 26 | 34 | 60 |
| Llaveros | 24 | 7 | 31 |
| Paraguas | 7 | 4 | 11 |
| Tecnología | 22 | 11 | 33 |

### Decisiones que conviene no deshacer (unificación)

- **El filtro resuelve UN solo nivel** (`category.canonical.slug`). Por eso la
  acción rechaza cadenas: una categoría con alias no puede volverse alias, el
  destino no puede ser alias de otro, y no puede apuntarse a sí misma. Sin
  esas validaciones se armarían cadenas que dejan productos invisibles en el
  filtro **sin que nada falle ruidosamente**.
- **El destino tiene que ser propio**, validado en la acción. En la base no se
  puede expresar como constraint.
- **`ON DELETE SET NULL`** y no CASCADE: si se borra una canónica, sus alias
  vuelven a ser categorías sueltas. Con CASCADE se borrarían categorías de
  proveedor que el conector recrea en el siguiente sync, con productos
  moviéndose solos.
- **Los slugs viejos de proveedor siguen resolviendo** después de unificar
  (verificado: 26 y 34). No se rompe ningún link que ande dando vueltas.
- **Una categoría unificada no muestra estado de visibilidad propio** en el
  panel, muestra "Bajo {canónica}": tener un toggle ahí haría pensar que se
  puede ofrecer sola en el filtro, y no se puede.

### Verificado y sin verificar

**Verificado ejecutando las funciones reales** (no solo compilando):

| Prueba | Resultado |
|---|---|
| Ocultar una categoría | sale del selector público (39 → 38) |
| …y sigue en el del panel | sí (39) — la trampa de los formularios |
| …y sus productos siguen llegando | 69 por URL directa, catálogo sin filtro en 728 |
| Detección de homónimas | los 4 pares exactos, ninguno de más |
| Unificar las dos "Escritura" | filtro 39 → 38, cero "Escritura" sueltas, canónica presente |
| Filtrar por la canónica | **60 productos = 34 CDO + 26 Zecat** |
| Slugs viejos de proveedor | siguen resolviendo (26 y 34) |
| Panel después de unificar | 1 propia, 2 alias, 60 productos totales |
| Sugerencias después | bajan de 4 a 3 — la resuelta deja de sugerirse |

La base quedó restaurada en los dos casos: 0 categorías ocultas, 0 alias.

**Verificado en el navegador** (primera versión, antes de la unificación): la
tabla dibuja las 39 filas con origen y conteo, el toggle muestra
"Ocultando..." y pasa a "Oculta", el filtro del catálogo pierde la categoría y
sus productos siguen apareciendo en la búsqueda.

**Verificado en el navegador el 2026-08-25, flujo completo de unificación:**

| Paso | Resultado |
|---|---|
| Bloque de sugerencias | los 4 pares con sus conteos (Escritura 60, Llaveros 31, Paraguas 11, Tecnología 33) |
| Nombre editable | se cambió "Escritura" por "Lapiceras y escritura" y se respetó |
| Unificar | la sugerencia desaparece, quedan 3 |
| Categorías de la tienda | "Lapiceras y escritura" con los 2 alias, su origen, **60 productos / 0 propios** |
| Filtro público | 39 → 38, cero "Escritura" sueltas, una sola entrada con el nombre nuestro |
| `/catalogo?categoria=lapiceras-y-escritura` | **"60 productos en Lapiceras y escritura"**, con bolígrafos de los dos proveedores |

Base restaurada: 39 en el filtro, las 2 "Escritura" de vuelta, 0 propias.

> **Trampa que costó DOS diagnósticos errados:** correr `npx prisma generate`
> con el dev server levantado lo deja con el cliente anterior. Las pantallas
> que usan campos nuevos tiran el error boundary aunque el código esté bien, y
> **el digest del error se repite**, lo que hace parecer que es caché del
> navegador. No lo es: una recarga dura da lo mismo.
>
> Cómo distinguirlo de un bug real, en dos pasos:
> 1. Correr la consulta aislada con `npx tsx` — si ahí anda, es esto.
> 2. Confirmarlo leyendo la consola del navegador: el error de Prisma lista
>    los campos que SÍ conoce, y ahí se ve cuál falta.
>
> **Después de cada `prisma generate`, reiniciar el dev server.**

---

## Conector de CDO Promocionales / Stocksur — pusheado y en producción

Segundo proveedor. **Pusheado, con Neon migrada y producción verificada.**
5 commits: `30e10b5` (conector), `8605797` (hosts de imágenes), `e6c54f6`
(fix de Decimal en la ficha), `02079c8` (calidad de imágenes).

**El sync sigue corriendo contra el entorno de pruebas de CDO y la base
local.** Producción tiene el código pero no los productos: sigue con los 553
de Zecat. 207 productos importados en local.

Se corre a mano: `npm run sync:cdo`. Última corrida: 207 procesados, 0
fallidos, 16,5s.

### Lo que hay que saber para retomar

**La API.** `X-Auth-Token` en el header, `page_size` (máximo 100) +
`page_number`. El listado trae **exactamente lo mismo** que el detalle, así
que el catálogo entero se baja en 3 requests y **no hace falta pedir producto
por producto** — a diferencia de Zecat.

**El SKU va SIEMPRE prefijado con el id del producto** (`cdo-{id}-{sku}`).
No es cosmético: **CDO repite el mismo sku en productos distintos** (5798 y
5799 comparten `T625-01+T521T-400MZ`). Con el sku pelado como clave única, el
upsert hacía que un producto le **robara** la variante al otro, y cuál ganaba
dependía del orden de procesamiento — resultado distinto en cada corrida. El
prefijo va siempre y no solo al detectar choque, porque prefijar reactivamente
haría que el sku dependiera de qué más vino en esa página. Además cubre las 13
variantes que vienen con `sku` vacío.

**El stock ya viene neto.** En Zecat el disponible es `stock - reservedStock`.
En CDO `stock_available` **ya es el neto** — verificado sobre las 411
variantes: `available > existent` no pasa nunca. Se guarda
`stock = existent` y `reservedStock = existent - available`, así el cálculo de
siempre devuelve exactamente `available` y además se conserva el total. Mapear
`available` directo a `reservedStock` daría lo reservado en vez de lo
disponible: el error justo al revés.

**Los precios son en dólares** (`net_price`, no `list_price`: es el que
coincide con el catálogo web de CDO). Se guardan tal cual con
`currency: USD` y **se convierten al leer** con `PricingConfig.usdRate`.

**Los iconos se clasifican por lista explícita de ids**, no por heurística
sobre el texto. "Grabado láser gratis" y "Grabado en láser" se parecen
muchísimo y son cosas distintas: una condición comercial y una técnica.
Adivinar por el nombre acierta hoy y falla callado mañana. Los ids que no
están en ninguna de las dos listas **se loguean** para clasificarlos a mano —
no se descartan en silencio.

**Sin foto usable → `active: false`.** CDO no tiene flag de publicado. Cada
corrida los reevalúa, así que si les cargan la foto se reactivan solos. Hoy
son **33 de 207**.

### Calidad de las imágenes: el problema de fondo

El filtro original solo miraba el nombre del archivo (`missing.png`, que son
el 29% de las imágenes de pruebas). Dejaba pasar cualquier otra cosa. Apareció
navegando el catálogo: "BOTELLA DAKOTA Y TAPA OCEAN KIT" entraba **activo**
con un `Selection_080.png` de **483×72** —el nombre que le pone GNOME a una
captura de pantalla recortada— y la card se veía vacía.

**El problema no se ve en la URL: hay que bajar la imagen y medirla.** El sync
mide todas las candidatas antes de escribir y clasifica:

| Veredicto | Criterio | Qué se hace |
|---|---|---|
| rota | no descarga o no es imagen | se descarta |
| chica | algún lado < 200px | se descarta |
| deforme | proporción > 2,5 | **entra**, con `object-contain` |
| ok | resto | entra normal |

**Las alargadas no se filtran a propósito**: "Destornillador" es 209×1514 y es
una foto legítima de un objeto largo. Con `object-cover` quedaba como una
banda ilegible. Filtrarla sería tirar producto vendible.

Dos detalles que conviene no deshacer:

- **La medición va fuera de la transacción.** Cada producto se escribe en su
  propia transacción, y hacer requests de red adentro la mantiene abierta
  esperando a la red, reteniendo conexiones del pool. Con 627 imágenes es
  pedir problemas. Por eso el sync es bajar → medir (de a 12) → escribir.
- **El `object-fit` va como estilo inline, no como clase.** `object-cover`
  viene en el `className` que manda la card, y entre dos utilidades de
  Tailwind gana la que esté después **en el CSS generado**, no en el string.
  Una clase no habría ganado de forma confiable.

La proporción la mide el navegador al cargar (`naturalWidth`/`naturalHeight`),
así que no hace falta guardar nada en el schema y vale para cualquier
proveedor.

**Números de la última corrida contra pruebas — anotarlos para comparar contra
producción de CDO:**

| | Portadas |
|---|---|
| ok | 151 |
| deformes (se muestran contenidas) | 19 |
| muy chicas (descartadas) | 4 |
| rotas (descartadas) | 4 |
| **total con portada** | **178** |

> Si en producción de CDO la proporción se mantiene, serían ~145 de 950
> productos con la portada comprometida. **Eso es material para hablar con el
> proveedor**, no algo a resolver del lado nuestro.

Cada corrida loguea estos cuatro números, justamente para poder comparar.

### Cambios de schema que trajo

- `ProductOrigin.CDO`.
- `Product.cdoId` (único, nullable) — propio, no reusa `externalId`.
- `Category.cdoCategoryId`.
- `ProductAttribute` (`productId`, `externalId`, `name`, `iconUrl`) para los
  iconos que no son técnicas de impresión.

> **Los datos de `ProductAttribute` se guardan pero no se muestran en ningún
> lado.** Está el modelo y lo escribe el sync; falta la UI.

### Bugs que aparecieron y por qué

Los dos son de la misma familia y valen como método: **`tsc` y `npm run build`
no ven los errores de render**. Se encontraron abriendo páginas, no
consultando la base.

- `8605797` — `next/image` con un host no configurado **rompe la página
  entera**, no muestra una imagen rota. CDO sirve todo desde CloudFront y el
  id de la distribución cambia entre entornos (pruebas `d1ok1ldurjeiif`,
  producción `d2jygl58194cng`), así que va con comodín `*.cloudfront.net`. El
  costo asumido: nuestro optimizador acepta cualquier URL de CloudFront. Es
  tolerable porque las URLs solo entran por los conectores y por Blob, nunca
  por input de usuario.
- `e6c54f6` — la ficha rompía en runtime: las variantes ahora cargan
  `costPrice`, y los `Decimal` de Prisma no cruzan a un client component. Se
  arregló **enumerando** los campos que cruzan, no con "todo menos costPrice":
  con la segunda forma, el día que se agregue otro `Decimal` vuelve a romper
  en runtime.

### Antes de apuntar a producción de CDO

1. Cambiar `CDO_API_URL` y `CDO_API_TOKEN`. Hoy apuntan a
   `api.argentina.cdo.dev.yellowspot.com.ar/v2` (**pruebas**).
2. **Confirmar los ids de los iconos**: la clasificación se relevó sobre los
   25 iconos de pruebas. Producción puede traer otros — el log de "sin
   clasificar" es el que avisa.
3. **Comparar la tabla de calidad de portadas** con los números de arriba.
4. Confirmar que el `usdRate` del panel sigue alineado con el que factura CDO.

> Apuntar a producción de CDO y pushear el código son **dos cosas
> independientes**. El push necesita la migración de Neon (ver la sección de
> arriba); apuntar a producción de CDO no necesita pushear nada, se puede
> hacer contra la base local.

---

## Precio por variante (cerrado y verificado en produccion)

El costo pasó de `Product` a `ProductVariant`, y los costos en dólares se
convierten **al leer**.

**Por qué**: hay proveedores con precios distintos por variante — en CDO, el
producto OCEAN tiene variantes a 194.97 y a 205.23. Un solo precio a nivel
producto obligaba a elegir uno y mostrarle al cliente un número que no
corresponde a lo que eligió.

**Por qué se convierte al leer y no al sincronizar**: mover `usdRate` en el
panel actualiza todo el catálogo al instante, sin re-sincronizar ~950
productos. Mismo criterio que el margen.

**Por qué `usdRate` es manual y no sale de una API de dólar**: el valor que usa
CDO (su web muestra $1510) es una **decisión comercial de ellos**, no el dólar
de mercado. Una API externa daría el oficial o el blue y desalinearía los
precios contra lo que CDO factura.

Los commits, en orden: `f33937e` (agregar + migración con backfill), `857b697`
(leer/escribir desde la variante), `07a2fae` (borrar `Product.costPrice`).

### La migración con backfill: la trampa

Prisma genera `ADD COLUMN ... NOT NULL` sin default, que sobre 1693 variantes
**falla** con `Null constraint failed` — verificado ejecutándolo. El peligro no
es esa falla, que es ruidosa: **es el arreglo obvio**. Agregarle `DEFAULT 0`
para que pase deja todas las variantes en costo cero, en silencio, sin que
nada se rompa hasta que alguien mire un precio.

Por eso está escrita a mano: nullable → backfill → NOT NULL, con el paso final
haciendo de red.

### Verificaciones hechas

Antes del `DROP`: 1694 variantes, 0 nulos, 0 en cero, **0 con costo distinto
al de su producto**, sumas idénticas, y **0 productos sin variantes** (ninguno
se quedaba sin precio).

Después, ejecutando las funciones reales de cada pantalla —no solo compilando—:
catálogo 24/24 con el precio esperado, home 8/8, panel OK, ficha correcta por
variante. Con un producto de dos variantes a 200 y 500: ficha 290 y 725, card
"Desde 290", y la cotización congela **725**.

### Decisiones que conviene no deshacer

- **Cards**: "Desde $X" **solo** cuando las variantes difieren; precio exacto
  cuando son iguales. Mostrar un piso es honesto; guardarlo como si fuera el
  precio sería mentir. Por eso `computePriceRange` se calcula al leer y no se
  persiste.
- **`submitQuote`** busca por `(productId, variantSku)`. Si el sku ya no
  existe, **omite la línea** en vez de cobrarla con el precio de otra variante,
  y deja un warning en el log. Antes, con el precio a nivel producto, esa línea
  se cobraba igual.
- **`computeSellPrice`** recibe moneda y `PricingConfig`. El sync de Zecat
  fuerza `Currency.ARS` al escribir, así que sus filas nunca entran por la rama
  de conversión.

---

## En pausa: sync automático con Vercel Cron

**Analizado a fondo el 2026-08-21, decidido, y explícitamente pospuesto.** No
construir todavía. El detalle completo (números medidos y las tres cosas a
contemplar) está en `PENDIENTES/pendientes.md`, en el ítem de automatizar el
sync. Resumen:

- Se va por **Vercel Cron sobre plan Pro** (el usuario lo va a contratar).
  Hobby quedaba descartado por dos límites duros: **300s de duración máxima no
  extensible** —el sync medido son 282s con base local, y solo los fetches a
  Zecat ya son ~253s— y **cron una vez por día**, donde una expresión más
  frecuente **rompe el deploy**.
- Al construirlo: **`preferredRegion` en `gru1`** (las funciones corren en
  `iad1` por defecto y Neon está en `sa-east-1`; son 12-15 round trips por
  producto), **lock de concurrencia** (hoy no hay ninguno) y **tabla
  `SyncRun`** para observabilidad, porque los logs de Vercel no alcanzan.

---

## Próximo paso concreto

**Armar el mapeo de categorías desde el panel** — es decisión de negocio, no
trabajo de código. La herramienta está construida, verificada en local y
deployada.

Lo urgente son las **homónimas**, porque hoy el cliente ve dos filtros con el
mismo nombre en producción:

| Par | Zecat | CDO | Total |
|---|---|---|---|
| Escritura | 26 | 34 | 60 |
| Llaveros | 24 | 7 | 31 |
| Paraguas | 7 | 4 | 11 |
| Tecnología | 22 | 11 | 33 |

El panel las sugiere solas. **Ojo con dos cosas que la sugerencia no cubre:**

- **Pares que NO detecta** (se escriben distinto y son lo mismo): "Hogar"
  (CDO, 24) vs "Hogar y Tiempo Libre" (Zecat, 26); "Carpetas, Bolsos y
  Mochilas" (CDO, 22) vs "Bolsos y Mochilas" (Zecat, 55); "Oficina y
  Negocios" (CDO, 28) vs "Escritorio" (Zecat, 22).
- **Un par que SÍ se parece y NO hay que unificar:** "Escritorio" y
  "Escritura" son cosas distintas.

Después, ocultar el ruido: campañas ("2026 *"), ofertas ("70%OFF *", con una
en **0 productos**) y las que no son categorías ("Próximos Arribos" 69,
"Logo 24hs" 76). Ahí sí conviene tener presente que sus productos quedan sin
vía de filtro.

**Primero conviene verificar la pantalla en producción**, que está deployada
pero todavía sin mirar con datos reales.

**Lo que queda del lado de CDO, aparte:**

- Decidir si se apunta a **producción de CDO** (hoy es el entorno de pruebas).
  Antes, la checklist de la sección del conector.
- Cargar `CDO_API_TOKEN` y `CDO_API_URL` en Vercel, si se quiere sincronizar
  contra Neon. Hoy el sync se corre a mano desde local, y **producción todavía
  no tiene ningún producto de CDO**.
- **Conversación con CDO, no trabajo de código:** ~15% de las portadas de
  pruebas son inservibles y 33 de 207 productos no tienen ninguna foto usable.
  Si el número se repite en producción, es un problema de ellos.

Después de todo eso, lo que sigue es **verificar en producción**, con la lista
de "Pendiente de verificar" en la mano.

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

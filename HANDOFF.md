# HANDOFF — Estado del trabajo

Registro del estado real del proyecto para poder retomar sin reconstruir contexto.
Se actualiza al final de cada tanda de trabajo.

**Última actualización:** 2026-08-18 — tanda 6
**Branch:** `main`, todo pusheado. Tanda 6: `03800c2` (refactor Link + hijo),
`7adbdc5` (indicador de navegación y cierre del panel mobile).

> Deployado **no es** verificado. Nada de las tandas 2 a 6 se miró todavía en
> producción — ver "Pendiente de verificar". Lo de la tanda 6 sí se probó en
> el navegador con el dev server, que es distinto de haberlo visto en Vercel.

> Este archivo es el estado del TRABAJO. Para el contexto de negocio y las
> decisiones cerradas, ver `CLAUDE.md`. Para el backlog largo, ver
> `PENDIENTES/pendientes.md`.

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

---

## En curso

### Estados de carga — las dos tandas escritas, la 2 sin deployar

El relevamiento está cerrado y **las dos tandas están implementadas**. Todo pasa
`tsc --noEmit`, `eslint` y `npm run build`.

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
  - **El indicador de navegación en un mobile real, con red real.** Es lo único
    que valida la tanda 6: se probó con el dev server, donde la latencia es
    artificial. Mirar que el chip/número se atenúe cuando la navegación tarda,
    que NO parpadee cuando es rápida, y que el panel de categorías se quede
    abierto con la fila marcada hasta que llega la página.
  - Que no haya quedado ningún texto sin tilde ni, peor, alguna URL rota por la
    pasada de ortografía. El commit no tocó URLs ni slugs, pero se revisa.

> Nota: `next dev` reescribe solo el bloque `nextjs-agent-rules` de `CLAUDE.md`.
> Si vuelve a aparecer como cambio sin commitear, es eso — se commitea junto con
> el trabajo y listo, borrarlo del diff solo lo regenera.

---

## Próximo paso concreto

**Verificar en producción todo lo acumulado** (tandas 2 a 6), con la lista de
"Pendiente de verificar" en la mano. Ya está todo deployado. En local no hay
latencia: los estados de carga no se ven nunca, así que mirarlo en Vercel —y en
un teléfono real, no en el navegador angostado— es lo único que valida el
trabajo.

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

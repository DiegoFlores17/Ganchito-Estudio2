# HANDOFF — Estado del trabajo

Registro del estado real del proyecto para poder retomar sin reconstruir contexto.
Se actualiza al final de cada tanda de trabajo.

**Última actualización:** 2026-08-18 — tanda 3
**Branch:** `main`. Tandas 1 y 2 pusheadas y deployadas. La **tanda 3 está
commiteada pero SIN pushear**: `46120d8` (revalidación de la home), `3c2a213`
(pantallas de error).

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
- **Tandas 2 y 3.** Pasan typecheck, lint y build. La 2 ya está deployada pero
  nada se miró en producción todavía; la 3 no está ni pusheada. Al verificar,
  mirar como mínimo:
  - Que el panel siga entrando bien (se tocó la autorización).
  - Que los skeletons del admin aparezcan al navegar **entre** pantallas del
    panel. Al entrar por primera vez el layout bloquea por el chequeo de
    autorización — eso es correcto y esperado, no un bug.
  - El shimmer del catálogo, con especial atención a las fotos ya cacheadas
    (recargar dos veces): si alguna queda invisible, falló el chequeo de
    `.complete` de `product-card-image.tsx`.
  - El filtro de `/admin/cotizaciones`, que pasó de recarga completa a navegación
    del router.

> Nota: `next dev` reescribe solo el bloque `nextjs-agent-rules` de `CLAUDE.md`.
> Si vuelve a aparecer como cambio sin commitear, es eso — se commitea junto con
> el trabajo y listo, borrarlo del diff solo lo regenera.

---

## Próximo paso concreto

**Pushear la tanda 3 y verificar todo lo acumulado en producción**, con la lista
de "Pendiente de verificar" en la mano. En local no hay latencia: los estados de
carga no se ven nunca, así que el deploy es lo único que valida el trabajo.

Para probar las pantallas de error hace falta forzar un fallo — lo más simple es
apuntar `DATABASE_URL` a una base inexistente en un preview de Vercel.

Lo único que queda abierto del tema estados de carga:

- **Estado pending en `category-filter.tsx` y `pagination.tsx`** — son `<Link>`
  puros. Ahora que `/catalogo` tiene `loading.tsx`, puede que ya alcance: hay que
  mirarlo en producción **antes** de agregar nada. `useLinkStatus` existe para
  esto, pero su propia doc advierte que si la ruta ya tiene fallback no hace
  falta, y meter indicadores de más es justamente lo que se quería evitar.

Después, la Home vuelve a la cola: quedó pendiente sumarle un bloque de logos de
marcas clientes (falta conseguir los logos).

Con eso confirmado, la **tanda 2 de estados de carga**:

1. `loading.tsx` para el resto de las rutas (`/`, `/cotizar` y las del panel).
   **Antes de las del panel**, resolver que `src/app/admin/(panel)/layout.tsx`
   llama a `requireAdmin()` (dato sin cachear en el layout ⇒ el fallback no se
   muestra).
2. Proteger el submit desprotegido de `src/app/admin/login/page.tsx:22`
   ("Continuar con Google") contra el doble click.
3. Pulir el feedback de las acciones del admin: hoy `team-management` y
   `toggle-active-button` solo cambian la opacidad. Sumar texto de estado.
   En `product-form`, avisar explícitamente cuando está procesando la imagen.
4. Indicador de pending en el filtro de `/admin/cotizaciones` (hoy es un `<form>`
   GET nativo, recarga sin señal).
5. Resolver la **decisión abierta** del punto 4 del relevamiento (shimmer vs.
   `blurDataURL`) y aplicarla al catálogo.

Después de los estados de carga, la Home vuelve a la cola: quedó pendiente sumarle
un bloque de logos de marcas clientes (falta conseguir los logos).

---

## Mantenimiento de este archivo

Al terminar cada tanda de trabajo, actualizar:

- La fecha y el commit de referencia del encabezado.
- Mover lo que se completó de "En curso" a "Terminado y verificado" — solo si se
  verificó de verdad, no solo si se escribió el código.
- Sumar a "Pendiente de verificar" lo que quedó construido sin probar.
- Reescribir "Próximo paso concreto" para que quien retome sepa exactamente
  dónde arrancar.

# HANDOFF — Estado del trabajo

Registro del estado real del proyecto para poder retomar sin reconstruir contexto.
Se actualiza al final de cada tanda de trabajo.

**Última actualización:** 2026-08-14 — tanda 1 de estados de carga
**Branch:** `main` (último commit en origin: `3dc2f4a`; la tanda 1 está en el
working tree, sin commitear)

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

---

## En curso

### Estados de carga — tanda 1 implementada, resto pendiente

El relevamiento completo está hecho y la **tanda 1 (prioridad alta) ya está
escrita**. Pasa `tsc --noEmit` y `eslint` sin errores. **Falta probarla en
producción** (ver "Pendiente de verificar").

Archivos de la tanda 1:

- `src/components/skeleton.tsx` — primitiva `<Skeleton />` compartida. Tinte
  violeta de marca a opacidad muy baja (`bg-primary/[0.07]`) + `animate-pulse`.
  Sobria a propósito: sin shimmer ni barridos.
- `src/app/(store)/catalogo/loading.tsx` — skeleton que replica el layout del
  catálogo. El título y la bajada se renderizan de verdad (son texto fijo, no
  dependen de la base); solo va en gris lo que espera datos.
- `src/app/(store)/producto/[id]/loading.tsx` — skeleton de 2 columnas
  (galería + miniaturas / nombre, descripción, panel de compra, personalización).
- `src/components/search-input.tsx` — `useTransition` alrededor del
  `router.replace` + spinner en el input mientras `isPending`, con `role="status"`
  para lectores de pantalla. Cubre `/catalogo` y `/admin/productos` de una.

**Bug encontrado y corregido en el camino** (ver sección aparte más abajo).

Situación de partida, verificada con `rg` sobre todo `src/` antes de empezar:

| | Antes | Ahora |
|---|---|---|
| `loading.tsx` | 0 | 2 |
| `error.tsx` | 0 | 0 |
| Skeletons / `animate-pulse` | 0 | sí (primitiva compartida) |
| `placeholder="blur"` | 0 | 0 (decisión abierta) |

El único indicador que existía era una línea de texto en
`src/app/(store)/cotizar/page.tsx:124` ("Cargando tu cotizacion...").

**Dato de la doc de Next 16.3** (`node_modules/next/dist/docs/.../loading.md:88`):
si un `layout.tsx` accede a datos sin cachear, el `loading.tsx` de ese segmento
**no** muestra fallback y la navegación bloquea igual. Se verificó que
`src/app/(store)/layout.tsx` es puro (solo Header/Footer), así que los dos
`loading.tsx` nuevos funcionan. **Ojo con el panel admin**: su layout llama a
`requireAdmin()`, que pega a la base — antes de agregarle `loading.tsx` hay que
resolver eso o los fallbacks no van a aparecer.

**Los cuatro frentes relevados:**

1. **Navegación entre páginas.** Ninguna ruta tiene `loading.tsx`. Todas las
   páginas son server components que consultan Neon antes de renderizar: hasta que
   vuelve la query, el usuario se queda en la pantalla anterior sin señal.
   Prioridad alta: `/catalogo` (3 queries en paralelo) y `/producto/[id]`.

2. **Acciones que envían datos.** Casi todo ya está cubierto con `useTransition` +
   `disabled` (product-form, pricing-config-form, quote-status-select, submit de
   cotización). Gaps encontrados:
   - `src/app/admin/login/page.tsx:22` — "Continuar con Google" es una server
     action pura, **sin protección contra doble click**. Es el único submit
     totalmente desprotegido.
   - `src/app/admin/(panel)/cotizaciones/page.tsx:28` — el filtro es un `<form>`
     GET nativo: recarga completa sin ninguna señal.
   - `team-management` y `toggle-active-button` — tienen `disabled`, pero el único
     feedback visual es `opacity-60`. El texto del botón no cambia.
   - `product-form` con imagen — es la acción más lenta (sharp procesa antes de
     subir) y solo dice "Guardando...".

3. **Búsqueda y filtros del catálogo.** Los tres controles navegan sin señal:
   - `src/components/search-input.tsx:35` — debounce de 350ms y `router.replace`
     **sin `useTransition`**. Los resultados viejos quedan en pantalla. Este
     componente se usa en `/catalogo` **y** en `/admin/productos`: un solo arreglo
     cubre ambos.
   - `category-filter.tsx` y `pagination.tsx` — `<Link>` puros, sin estado pending.

4. **Carga de imágenes.** `next/image` se usa en todos lados, pero sin ningún
   `placeholder`. Los cuadrados grises del catálogo son el
   `bg-foreground/[0.03]` del contenedor en `product-card.tsx:33`.

**Decisión abierta (bloquea el punto 4):** `placeholder="blur"` con imágenes
remotas exige un `blurDataURL` generado a mano — Next solo lo genera automático con
imports estáticos. Las imágenes de Zecat son URLs remotas que se borran y recrean
en cada sync, así que generar el blur de 552 productos implicaría descargar cada
imagen en cada corrida. Dos caminos:

- **A)** Shimmer en el contenedor + fade-in con `onLoad`. Cero costo, cero cambio
  de schema, aplica igual a Zecat y a manuales. **Recomendado.**
- **B)** Columna `blurDataUrl` en `ProductImage` generada con sharp. Barato para
  productos manuales (sharp ya corre al subir), caro para Zecat.

**Estética:** los skeletons y spinners van en la paleta de marca según `DISENO/DISENO.md`,
sobrios, sin animaciones estridentes. El riesgo a evitar es una interfaz que
parpadea por todos lados: por eso el mapa va antes que el código.

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
- **La tanda 1 de estados de carga, en producción.** Pasa typecheck y lint, pero
  los skeletons solo se ven con latencia real: hay que deployar y mirar
  `/catalogo` y `/producto/[id]` en Vercel. Confirmar de paso que el fix de la
  paginación quedó bien (entrar a `/catalogo?page=3` y verificar que la URL
  **no** pierde el `page`).

### Desincronizaciones detectadas en la documentación

- **`CLAUDE.md` tiene cambios sin commitear** (`git status` marca ` M CLAUDE.md`).
  Son dos cosas: el bloque `nextjs-agent-rules` que `next dev` reescribe solo, y
  la sección "Mínimo de compra" que se movió a `PENDIENTES/pendientes.md`.
  Conviene commitearlo para dejar el árbol limpio.

---

## Próximo paso concreto

**Deployar la tanda 1 y verla en producción.** Es lo único que valida el trabajo:
en local no hay latencia y los skeletons no aparecen nunca. Mirar `/catalogo` y
`/producto/[id]`, y confirmar que `/catalogo?page=3` ya no pierde el `page`.

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

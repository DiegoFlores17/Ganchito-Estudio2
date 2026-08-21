# PENDIENTES — Proyecto tienda Ganchito Estudio

Cosas identificadas que NO se resuelven ahora, para no perderlas. Se abordan en su
etapa correspondiente (la mayoría en la pasada de diseño final o en el deploy).

---

## Pulido de diseño (pasada final — en curso, fase por fase)

- [x] **Filtros de categoría en mobile:** resuelto en la Fase 2 — boton
      "Filtrar por categoria" que abre un panel (`fixed inset-0`, mismo patron
      que el menu del header) con las 27 categorias en una lista, en vez de
      pills apiladas. El boton muestra la categoria activa.
- [x] **Cards de producto se cortan en mobile:** re-verificado en la Fase 1, no
      reproduce mas — probablemente resuelto en una pasada anterior.
- [x] **Botón "Pedí tu cotización" del header se corta en mobile:** resuelto en
      la Fase 1 con menú hamburguesa (`MobileNav`) que colapsa nav + CTA.
- [x] **Catálogo en general necesita pulido estético:** resuelto en la Fase 2 —
      titulo mas grande (5xl), mas aire entre buscador/filtro/grilla, contador
      de resultados ("553 productos" / "54 productos en X" / con busqueda),
      mas espacio vertical entre filas de la grilla.
- [x] **Card de producto pulida (Fase 1):** fondo de imagen consistente
      (border sutil), jerarquía de precio marcada, `line-clamp` en el nombre
      para altura pareja de card. Es el mismo componente reutilizable, listo
      para destacados (home) y relacionados (ficha) cuando existan.

## Logo / marca

- [ ] **Falta variante del logo para fondos oscuros.** Hoy hay un solo archivo. El
      logo completo del header es un SVG estático que no se va a leer sobre fondo
      violeta oscuro (ej: hero con fondo Indigo, como sugiere el brief). Conseguir o
      generar una versión clara/monocromática para esos fondos.

## Precios / catálogo

- [ ] **236 productos con `currency: USD`** (dato sucio de Zecat, se tratan como ARS).
      Lista logueada en el sync. Revisar en algún momento si alguno es un importado
      real en dólares.
- [ ] **Productos en SALE:** el descuento ya viene en el `price` de Zecat. A futuro,
      si se quiere mostrar "precio tachado" original, resolverlo aparte.
- [ ] **Índice de búsqueda:** la búsqueda del catálogo (`unaccent` + `ILIKE` vía
      `$queryRaw`) hoy no tiene índice — no hace falta con 552 productos (instantáneo
      igual). Si el catálogo crece a varios miles de productos, evaluar un índice
      GIN con `pg_trgm` sobre `unaccent(lower(name))` (y lo mismo para
      `description`/categoría) antes de que se note lento.

## Deploy (etapa final) — HECHO

El proyecto está deployado y funcionando en https://ganchito-estudio2.vercel.app
(Vercel + Neon + Vercel Blob).

- [x] **Configurar base de producción y variables de entorno en Vercel.** Resuelto —
      base en Neon (PostgreSQL), variables cargadas en Vercel. Verificado en
      producción.
- [x] **Agregar las URLs de producción a Google Cloud Console.** Resuelto —
      orígenes autorizados y redirect URIs de Vercel agregados. Verificado: el
      login del panel funciona en producción.
- [x] **Migrar `src/lib/storage.ts` a Vercel Blob.** Resuelto — `saveUploadedFile()`
      usa `put()` de `@vercel/blob` (`access: "public"`). La route handler
      `/api/uploads/[...path]` se eliminó (Blob sirve los archivos directo desde
      su propio dominio). Inline vs. descarga sigue siendo por extensión, no por
      origen del archivo: raster (png/jpg/jpeg/webp) devuelve la `url` normal
      (inline), todo lo demás (pdf/svg/ai/eps) devuelve la `downloadUrl` de Blob
      (fuerza descarga). Cubre los dos usos: logos de cotización y fotos de
      producto manual. Verificado en producción: se cargó un producto con imagen
      desde el panel de Vercel end-to-end.

      > **Gotcha del `BLOB_READ_WRITE_TOKEN`.** Al conectar el store de Blob,
      > Vercel creó la variable con el nombre autogenerado del store (algo tipo
      > `<store>_READ_WRITE_TOKEN`), no con el nombre estándar. El SDK
      > `@vercel/blob` busca exactamente `BLOB_READ_WRITE_TOKEN`, así que hubo
      > que crearla a mano con ese nombre. **Si se cambia de store de Blob,
      > revisar esto primero** — el síntoma es que las subidas fallan por falta
      > de token aunque en el dashboard se vea el store conectado.
- [ ] **Evaluar URLs firmadas (`access: "private"`) para los logos que suben los
      clientes.** Hoy son URLs públicas no adivinables (mismo nivel de seguridad
      que tenía el filesystem local) — si algún cliente sube arte confidencial,
      conviene revisarlo.
- [ ] **Archivos huérfanos en Blob.** Cuando se borra una imagen de producto
      desde el admin, hoy solo se borra la fila `ProductImage` — el archivo en
      Blob queda huérfano (esto ya pasaba con el filesystem local, no es nuevo).
      La diferencia es que en Blob el almacenamiento tiene costo asociado, a
      diferencia del filesystem local. Evaluar borrar el blob con `del()` al
      borrar la imagen.
- [ ] **Automatizar el sync con cron** (Vercel Cron), cada 3-6 hs, para la
      actualización semi-en-vivo. Hoy se corre a mano con `npm run sync:zecat`.

      **Analizado y decidido (2026-08-21), falta construir.** Se va por Vercel
      Cron sobre plan **Pro**. Descartadas: GitHub Actions (se prefiere no
      duplicar secrets) y el batching encadenado en Hobby.

      Por qué Hobby no servía, medido y verificado contra la doc de Vercel:
      - **Duración**: Hobby tiene 300s de máximo, que además es el default y
        **no se puede extender**. El sync medido son **282s con base local**
        (94% del techo), y **solo los fetches a Zecat ya son ~253s** — 550
        productos × ~400-550ms cada uno, secuencial. El cuello es la API de
        Zecat, no la base.
      - **Frecuencia**: en Hobby el cron corre **una vez por día**, y una
        expresión más frecuente **rompe el deploy**, no falla en runtime.
        Precisión ±59 min.

      Con Pro: 800s de duración y cron por minuto, así que cada 3-6 hs entra.

      **Al construirlo, tres cosas que ya salieron del análisis:**
      1. **Mover la función a `gru1` (São Paulo)** con `preferredRegion`. Por
         defecto las funciones corren en `iad1` (Washington) y Neon está en
         `sa-east-1`: `syncProduct` hace 12-15 idas y vueltas a la base **por
         producto**, así que a ~120ms de cruce son 15+ minutos solo de base.
      2. **Lock de concurrencia.** Vercel no impide invocaciones solapadas, y
         hoy el sync **no tiene ningún lock** — dos corridas ya se pisarían.
         El upsert es idempotente, pero imágenes y áreas de impresión se
         borran y recrean, así que dos corridas concurrentes sobre el mismo
         producto pueden dejar imágenes duplicadas.
      3. **Tabla `SyncRun`** (última corrida, duración, creados/actualizados/
         fallidos, errores). No es un lujo: en Hobby los logs duran **1 hora**
         y hay un techo de **256 líneas por request** — el sync loguea un
         warning por cada producto con `currency: USD` (236), así que
         reventaría el límite igual. Con Pro los logs duran 1 día, que sigue
         siendo poco para un cron. Hace falta el registro en base para poder
         verlo desde el panel.
- [ ] Confirmar si el token de Zecat es de preprod o producción y apuntar la
      `ZECAT_API_URL` correcta.

## Funcionalidad futura (post primer release)

- [ ] **Flag `featured` en `Product`.** Hoy los "Productos destacados" de la
      home (`getFeaturedProducts` en `src/lib/catalog.ts`) muestran los
      últimos sincronizados con foto — sirve para arrancar, pero depende del
      orden del sync, no de una elección real. Agregar un booleano editable
      desde el admin para elegir a mano qué se destaca.
- [ ] **Panel de administración:** editar `defaultMarginPercent`, cargar productos
      manuales, sumar otros proveedores. (Va después del circuito cliente completo.)
- [ ] **Margen por producto** que pise el global (el schema ya está preparado, sin
      implementar).
- [ ] Mercado Pago / pago online (por ahora solo cotización).

## Multi-proveedor (cuando aparezca un segundo proveedor real)

- [ ] **Construir el sistema de conectores genérico + la gestión de proveedores
      con API.** La tabla `Supplier` ya quedó plantada en el schema (vacía, sin
      lógica) para reservar la estructura. El día que haya un segundo proveedor
      real: escribir su conector siguiendo el patrón del de Zecat, refactorizar
      el conector de Zecat para que ambos sigan el mismo contrato, y construir la
      pantalla de admin para cargar proveedor + API key. NO se construye antes de
      tener un caso concreto (diseñar en abstracto lleva a rehacer).

      - [ ] **Sincronizar dos listas de acceso al panel al sumar/sacar admins:** los
      "Test users" en Google Cloud Console Y la tabla `AdminUser`. Alguien tiene
      que estar en las dos para entrar. Al agregar o sacar gente, acordarse de ambas.
- [ ] **Sacar la app OAuth de Google del modo "Testing" si el equipo crece:** en
      Testing hay límite de usuarios de prueba. Para el equipo chico actual alcanza,
      pero si suma mucha gente, evaluar publicar la app.
- [x] **Agregar la URL de producción a Google Cloud Console:** resuelto — el
      dominio de Vercel está en orígenes autorizados y el redirect
      `/api/auth/callback/google` de producción está cargado. Verificado
      entrando a `/admin` en producción.

## Margen Personalizado para cada producto 

- [ ] Poder editar el margen de ganancia de cada precio para cada producto manualmente.

## Editar Productos

-[ ] Poder eliminar, editar precio cantidad margen etc en cada producto

## Categorías (después del diseño)

- [ ] **Limpiar las categorías del catálogo (Opción A: visibilidad editable).**
      Hoy se muestran las 27 de Zecat crudas, mezcladas: campañas temporales
      ("2026 Agro", "2026 Minería", "Próximos Arribos"), duplicados de oferta
      ("70%OFF Bolsos y Mochilas") y categorías reales ("Drinkware", "Gorros").
      Confunden al cliente. Solución: agregar un campo `visible` (bool) a la
      tabla Category + una pantalla en el panel admin para ocultar/mostrar cada
      una. Ocultar campañas y duplicados de oferta, dejar las reales. Los
      productos de categorías ocultas siguen apareciendo en el catálogo (un
      producto está en varias categorías); solo se saca la categoría como filtro.

## Minimo de compra 

- [] Marcar en el detalle de la cotización (panel admin) cuando un producto está por debajo de su minOrderQuantity, para detectarlo al revisar.

- [ ] **Header: el botón/link de "Catálogo" queda muy lejos o poco accesible.**
      Revisar la jerarquía y el espaciado de la navegación (sidebar/topbar) para
      que llegar al catálogo sea inmediato — es la acción más frecuente del
      cliente. Evaluar en contexto de la Home terminada.

      - [ ] **Aviso cuando el stock de una variante es menor al minOrderQuantity.**
      Hoy se puede cargar una variante con 2 de stock en un producto con mínimo 3,
      sin ninguna advertencia. No siempre es un error (el mínimo se valida sobre el
      TOTAL del producto, así que puede completarse con otras variantes; y además
      permitimos cotizar sin stock con "Consultar disponibilidad"). Pero hay dos
      casos problemáticos: producto con una sola variante donde stock < mínimo, y
      producto donde la SUMA de stock de todas las variantes < mínimo. En esos
      casos el cliente no puede completar el pedido nunca.
      Propuesta: aviso en el panel al cargar (no bloqueo), y del lado público
      mostrar "consultanos por disponibilidad" si el stock total no alcanza el mínimo.
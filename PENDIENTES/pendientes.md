# PENDIENTES — Proyecto tienda Ganchito Estudio

Cosas identificadas que NO se resuelven ahora, para no perderlas. Se abordan en su
etapa correspondiente (la mayoría en la pasada de diseño final o en el deploy).

---

## Flujo de cotización

- [ ] **Notificación por email a Ganchito cuando entra una cotización.** Quedó
      planificada y sin construir (se priorizó el WhatsApp). El plan acordado:
      **Resend** (free tier sobra), `RESEND_API_KEY` en Vercel + redeploy,
      destino = `SiteConfig.contactEmail` (cero migración), remitente
      `onboarding@resend.dev` hasta que haya dominio verificado en Resend —
      **ojo: `vercel.app` no se puede verificar; ahora que existe
      `ganchitoestudio.com`, se puede verificar ese y usar un remitente
      propio**. Si el envío falla: log y nada más, la cotización ya está
      guardada. Link del aviso a `/admin/cotizaciones/{id}` con
      `NEXT_PUBLIC_SITE_URL` de base.
- [ ] **Escala de descuento por volumen de Zecat (opción B del fix de
      precios).** El costo importado es el del tramo base; la API trae además
      `discountRangeProduct` por variante: 6 tramos acumulativos de 0.1%
      (2 u.) a 5.1% (2700+ u.) de descuento adicional. Ignorarla juega a
      favor (se cotiza apenas alto en pedidos enormes), por eso quedó afuera
      del fix. Si algún día se quiere precisión por cantidad: tabla de tramos
      por variante + `computeSellPrice` por cantidad + congelar por tramo al
      cotizar + la ficha mostrando precio por cantidad. No es chico.
- [ ] **`printingType` nunca se carga — y ahora sabemos dónde vive el costo.**
      El campo existe en `QuoteItem`, y el mensaje de WhatsApp lo muestra si
      está — pero el panel de compra no pide técnica, así que siempre va null.
      El hallazgo nuevo (2026-08-31): la API de Zecat trae
      `genericPrintingTypeTemplate` por variante con **`setupPrice` y
      `unitPrice` de cada técnica** (ej: bordado $70.000 de setup + $1.214,90
      por unidad, con su propia escala de descuento en `hitDiscountRanges`).
      O sea que cotizar la personalización con costo real es posible. Decidir:
      el cliente elige técnica al cotizar (y se cotiza su costo), o se borra
      el campo.

## Fix de precios de Zecat (2026-08-31)

- [ ] **Re-import de PRODUCCIÓN** — esperando el OK tras el informe local
      (0 salteados, 0 pausados). Antes: branch en Neon (la saca el usuario).
      Después: decidir las cotizaciones existentes (pruebas → borrar;
      reales → dejar).
- [x] **Los 15 productos zombie**: pausados en producción (14 — el 4792 no
      existía allá). Siguen pausados en local también.
- [ ] **Las campañas homónimas de los dos proveedores son trabajo manual
      RECURRENTE del cliente.** Cada campaña nueva de cada proveedor ("Día de
      la Madre" la traen Zecat Y CDO) aparece como categoría visible y el
      cliente tiene que ocultarla o unificarla a mano, campaña por campaña,
      temporada tras temporada. El fix de colisión de slugs evita que el sync
      explote, pero no resuelve esto. Idea a evaluar (decisión de producto):
      que las categorías NUEVAS de proveedor nazcan con `visible: false` y el
      panel muestre una cola de "categorías sin revisar" — invierte el
      default: el ruido no llega al cliente hasta que alguien lo apruebe.
      Matcheo automático por nombre sigue descartado (filosofía del
      proyecto).

## De la auditoría pre-entrega (2026-08-27, ver AUDITORIA.md)

Los hallazgos 1, 3, 4 y 6 se atacaron en la rama de la auditoría. Estos
cuatro quedaron a propósito, cada uno con su cuándo:

- [ ] **(Hallazgo 2) Anti-abuso en el formulario público de cotización** —
      **después del lanzamiento real**, cuando haya tráfico que proteger.
      `submitQuote` no tiene rate limit ni honeypot; cada envío puede subir
      15MB a Blob (que factura). La validación de entrada y de contenido ya
      corta lo peor; lo que falta es el volumen. Empezar por el honeypot
      (barato, sin dependencias) y evaluar el firewall de Vercel o Upstash si
      aparece spam de verdad. Un rate limit en memoria NO sirve en serverless.
- [ ] **(Hallazgo 5) Fijar el hostname de CloudFront en `next/image`** —
      cuando se confirme el id de la distribución de producción de CDO. El
      comodín `*.cloudfront.net` deja que cualquier distribución del mundo
      pase por nuestro optimizador (cuota de Vercel: 5K/mes en Hobby). Ojo al
      verificar: un host no configurado **rompe la página entera** — probar
      el catálogo completo tras el cambio.
- [ ] **(Hallazgo 7) Paginar `getQuotes`** — cuando el panel pase de ~200
      cotizaciones. Hoy trae TODAS las filas (con nombre, email y teléfono)
      en cada carga del listado. Red de seguridad barata mientras tanto:
      `take: 200`. La paginación completa pide UI, no es una línea.
- [ ] **(Hallazgo 9) Unificar el contrato de los dos conectores** — como
      **PRIMER paso del trabajo del cron de productos**, no antes. Zecat
      (259 líneas) y CDO (366) comparten toda la forma sin compartir código:
      el lock de concurrencia y la tabla `SyncRun` del cron habría que
      escribirlos dos veces. Refactorizar justo antes de ese trabajo lo paga;
      refactorizar antes de la entrega solo agrega riesgo.

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

      **OJO — dato nuevo del 2026-08-25:** el sync de **CDO producción tarda
      597s (~10 min)**, casi todo medición de imágenes. Contra el techo de 800s
      de Pro entra, pero con **poco margen**, y eso es UN solo proveedor. Si se
      automatizan los dos, o si CDO crece, hay que paginar el trabajo o sacar la
      medición de imágenes del camino del sync (por ejemplo, medir solo las URLs
      que cambiaron desde la corrida anterior).

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
- [x] **Cargar `CRON_SECRET` en Vercel (Production) y redeployar.** Hecho y
      verificado: la corrida de las 19:26 dio **200** con `vercel-cron/1.0`.
      Antes daba 503 porque la variable no existía. **El falso positivo que nos
      costó una vuelta**: el botón "Actualizar ahora" del panel **no usa el
      secret** (va por una Server Action), así que verlo funcionar no probaba
      nada sobre el endpoint. Y ojo con **redeployar**: las variables se
      inyectan en el deployment.
- [ ] **Poner `sslmode=verify-full` explícito en la `DATABASE_URL` de Neon.** El
      log del cron tira: *"The SSL modes 'prefer', 'require', and 'verify-ca' are
      treated as aliases for 'verify-full'. In the next major version
      (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt standard
      libpq semantics, which have weaker security guarantees."*

      **No rompe nada hoy** —el modo actual se comporta como `verify-full`— pero
      al actualizar `pg` a v9 la misma connection string va a **validar menos, en
      silencio, sin que nada falle**. Es una degradación de seguridad que no avisa
      cuando ocurre, solo antes. Hacerlo antes de esa actualización.
- [ ] **`preferredRegion = "gru1"` en las funciones que pegan mucho a la base.**
      Confirmado con dato real en el log del cron: la función corre en **`iad1`
      (Washington)** y Neon está en `sa-east-1`. Para el cron del dólar da igual
      (dos queries), pero el sync de productos hace 12-15 idas y vueltas **por
      producto**. Ver el ítem de automatizar el sync.
- [x] **Enchufar el cron de la cotización del dólar.** Hecho: `vercel.json` con
      `0 19 * * *`. **Las expresiones de Vercel son UTC**, así que corre a las
      **16:00 ART**, después de que el BNA cierre — dolarapi actualiza a las
      18:00Z (15:00 ART), y correr antes traería el valor del día anterior.
      No hizo falta Pro: para el dólar, Hobby alcanza. Ojo que en Hobby una
      expresión más frecuente que diaria **rompe el deploy**, no falla en
      runtime.
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

## Multi-proveedor — el segundo proveedor ya llegó (CDO Promocionales / Stocksur)

- [x] **Escribir el conector de CDO siguiendo el patrón del de Zecat.** Hecho.
      207 productos del entorno de pruebas, 0 fallidos. Se corre con
      `npm run sync:cdo`. Las trampas de la API (sku repetido entre productos,
      stock ya neto, precios en USD, iconos) están documentadas en `CLAUDE.md`.
- [ ] **Migrar Neon y pushear el conector.** Es el próximo paso concreto del
      proyecto — ver `HANDOFF.md`. **El código está commiteado y SIN pushear a
      propósito**: trae la migración `20260821174829_add_cdo_provider` que Neon
      todavía no tiene. Primero la base, después el push.
- [ ] **Apuntar CDO a producción** (hoy `CDO_API_URL` es el entorno de pruebas).
      Pasa de 207 a ~950 productos. Antes: revisar la checklist de la sección
      del conector en `HANDOFF.md`.
- [ ] **Refactorizar el conector de Zecat para que ambos sigan el mismo
      contrato.** Ahora que hay dos conectores reales se puede diseñar sobre
      casos concretos en vez de en abstracto. Hoy comparten la forma (upsert por
      id externo, una transacción por producto, imágenes borradas y recreadas)
      pero no comparten código.
- [ ] **Gestión de proveedores desde el panel.** La tabla `Supplier` sigue
      plantada, vacía y sin lógica. Falta la pantalla de admin para cargar
      proveedor + API key, en vez de tener los tokens sueltos en el `.env`.

### Material y capacidad en la ficha (dato de Zecat que hoy se pierde)

- [ ] **Mostrar material y capacidad de los productos de Zecat.** Para merch
      corporativo "Acero inoxidable, 500 ml" es información que el cliente busca, y
      **ya viene estructurada** en el campo `subattributes` de la API de Zecat, que
      hoy no mapeamos.

      Relevado el 2026-08-26 sobre una muestra de 40 productos (endpoint de detalle;
      el listado trae `subattributes` pero **sin** el `attribute_id`, así que no
      sirve para agrupar):

      | Grupo | Contenido |
      |---|---|
      | 9 y 23 | material: Acero, Aluminio, Plástico, Cerámica, Metal |
      | 3 | capacidad en ml: "Menos de 500 ml", "501 a 1000 ml" |
      | 4 | capacidad en litros: "Menos de 10 Litros", "Más de 20 Litros" |
      | 2 | marca/línea: Tahg, Re use me, Pampa Spirit, Kingtech |

      **Lo que NO sirve de ahí:** el grupo 8 son técnicas de impresión, que ya
      mapeamos desde `printing_types`; y los grupos 5, 19, 20, 21 y 22 son flags
      **"Si"/"No" sin nombre** — la API no dice qué significa cada `attribute_id` y
      **no hay endpoint que los liste** (probados `/attribute`, `/attributes`,
      `/subattribute`, `/generic_product_attribute`: los cuatro dan 404).

      **Al implementarlo, dos cosas:** la capacidad viene como RANGO en texto
      ("501 a 1000 ml"), no como número, así que no sirve para filtrar ni ordenar
      sin parsearla. Y los grupos hay que confirmarlos sobre el catálogo completo,
      no sobre la muestra de 40 — puede haber grupos que no aparecieron.

      > Ojo con el modelo: esto NO va en `ProductAttribute`, que es para
      > características binarias tipo "Reciclable". Material y capacidad son
      > campos con valor, y mezclarlos convertiría el bloque "Características"
      > en una bolsa de todo.

### Categorías múltiples: estamos tirando el 87% de la información

- [ ] **Guardar TODAS las categorías de un producto, no solo la primera.**
      Relevado contra la API de **producción** de CDO el 2026-08-25: cada producto
      trae **7,7 categorías en promedio, hasta 21**, y **299 de 301 tienen más de
      una**. Los dos conectores toman solo la primera (`families[0]` en Zecat,
      `categories[0]` en CDO) y descartan el resto, porque `Product.categoryId` es
      una FK simple.

      **Por qué importa más ahora:** acabamos de construir la unificación de
      categorías. Con una sola categoría por producto, ocultar o no unificar una
      deja a sus productos sin ninguna vía de filtro. Con varias, el producto
      seguiría siendo alcanzable por las otras — el problema que hoy nos obliga a
      elegir con cuidado desaparecería casi entero.

      **Qué implica:** tabla intermedia `ProductCategory` (migración de expansión
      + backfill desde `categoryId`), tocar los dos conectores, y revisar el filtro
      del catálogo y el conteo del panel. **No es chico.** Evaluar después de que
      el mapeo de categorías esté armado y en producción, para no mover dos cosas
      a la vez.

      > Ojo al diseñarlo: en producción de CDO la primera categoría suele ser la
      > REAL ("Escritura") y las de campaña vienen después ("Reingresos Super
      > Esperados"). Ese orden es información, no ruido: si se guardan todas,
      > conviene conservar la posición.

### Pendientes que dejó el conector de CDO

- [x] **Atributos de producto en la ficha.** Resuelto: bloque "Características" con
      chips violetas, arriba de "Personalización". 764 atributos sobre 301 productos
      de CDO.

      **Zecat no tiene equivalente**, relevado contra su API el 2026-08-26. No es
      que no lo mapeamos: el dato no existe como tal. Ver el detalle en HANDOFF.
      Sus productos simplemente no muestran el bloque, que era el fallback previsto.
- [x] **Calidad de fotos de CDO: NO hace falta hablar con ellos.** Medido contra
      la API de **producción** el 2026-08-25: **300 de 301 portadas están bien, 1
      es muy chica, cero deformes y cero rotas (0,3%)**. El 15,2% de portadas
      inservibles era del entorno de PRUEBAS, no de su catálogo real. Se midió
      antes de escribirles, y menos mal.
- [ ] **Revisar los ids de iconos de CDO al pasar a producción.** La clasificación
      (técnica de impresión vs. atributo) se relevó sobre los 25 iconos del entorno
      de pruebas, con listas explícitas de ids en `src/lib/cdo/normalize.ts`.
      Producción puede traer otros: el sync loguea los "sin clasificar", hay que
      mirar ese log y agregarlos a mano.
- [ ] **`NEON_DATABASE_URL` volvió al `.env` — decidir si se saca.** Estaba
      resuelto el 2026-08-21 (12 claves, ninguna de Neon), pero al 2026-08-26 el
      `.env` tiene **14 claves y una es `NEON_DATABASE_URL`**.

      **Lo crítico sigue bien:** `DATABASE_URL` apunta a `localhost`, verificado, así
      que Prisma no toca producción por accidente. Y ningún `.env` está trackeado en
      git (solo `.env.example`), así que no se filtró.

      Lo que sí contradice es el espíritu de la regla: la URL de producción **queda
      guardada en un archivo** en vez de pasarse inline cuando hace falta. Decidir si
      se saca o si se acepta a conciencia y se actualiza la regla — lo que no conviene
      es que el documento diga una cosa y el archivo tenga otra.

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

- [x] **Construida la visibilidad editable de categorías.** Campo `Category.visible`
      (default true) + pantalla `/admin/categorías` con origen, cantidad de productos
      y toggle. Resuelve el RUIDO: campañas ("2026 *"), ofertas ("70%OFF *") y cosas
      que no son categorías ("Próximos Arribos", "Logo 24hs").
- [x] **Construida la unificación de categorías homónimas.** Campo
      `Category.canonicalId` + alta de categorías propias y sugerencias en el mismo
      panel. Resuelve las DUPLICADAS entre proveedores, que ocultar no resolvía:
      sacar una del filtro dejaba a sus productos sin ninguna vía de filtro, porque
      cada producto tiene una sola categoría.
- [ ] **Armar el mapeo de categorías — EN MANOS DEL CLIENTE.** La herramienta está
      construida y deployada; la decisión de qué unificar y qué ocultar la resuelve
      el cliente. No avanzar por nuestra cuenta.

      Con el catálogo REAL de CDO ya en local (855 productos, 57 categorías) los
      pares homónimos son **cinco**, no cuatro: Escritura (Zecat 26 + CDO 42),
      Llaveros (24 + 5), Paraguas (7 + 8), Tecnología (22 + 9) y **Gorros (4 + 1)**,
      que no existía en el entorno de pruebas. Más las de campaña de CDO: Día de la
      Madre, Mundial 2026, Mes Rosa, San Valentín, Primavera, AgroActiva, FIT,
      Vuelve con todo.
- [ ] **Revisar los pares que el matcheo por nombre NO detecta.** El panel sugiere por
      nombre normalizado, así que estos hay que verlos a ojo: "Hogar" (CDO, 24) vs
      "Hogar y Tiempo Libre" (Zecat, 26) son lo mismo y no matchean; "Carpetas, Bolsos
      y Mochilas" (CDO, 22) vs "Bolsos y Mochilas" (Zecat, 55); "Oficina y Negocios"
      (CDO, 30) vs "Escritorio" (Zecat, 22). Y al revés: "Escritorio" y "Escritura" se
      parecen y **no** hay que unificarlas.
- [ ] **Limpiar las categorías del catálogo (Opción A: visibilidad editable).**
      **Ahora es más urgente: con CDO el problema se duplica.** El conector de
      CDO importa TODAS sus categorías, incluidas las de campaña ("Día de la
      Madre", "Precios Wow") — filtrarlas por nombre desde el conector sería
      adivinar, así que la visibilidad se resuelve acá, con un campo editable que
      sirve igual para los dos proveedores.
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
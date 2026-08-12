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

## Deploy (etapa final)

- [ ] **Migrar `src/lib/storage.ts` a Vercel Blob antes de deployar.** Hoy los
      logos de las cotizaciones se guardan en disco local (`uploads/`, gitignored) —
      funciona en local pero el filesystem de las funciones serverless de Vercel
      es efímero, no persiste. Es un solo punto de cambio: la función
      `saveUploadedFile()`. La route handler que sirve los archivos
      (`/api/uploads/[...path]`) también hay que reemplazarla por las URLs que
      devuelve Blob directamente.
- [ ] **Automatizar el sync con cron** (Vercel Cron), cada 3-6 hs, para la
      actualización semi-en-vivo. Hoy se corre a mano con `npm run sync:zecat`.
- [ ] Configurar base de producción (Neon o Supabase) y variables de entorno en Vercel.
- [ ] Confirmar si el token de Zecat es de preprod o producción y apuntar la
      `ZECAT_API_URL` correcta.

## Funcionalidad futura (post primer release)

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
- [ ] **Agregar la URL de producción a Google Cloud Console:** hoy solo está
      `localhost:3000` en los orígenes y redirect URIs. Al deployar, sumar el
      dominio real (y el redirect `/api/auth/callback/google` de producción).


      - [ ] **Migrar `src/lib/storage.ts` a Vercel Blob antes de deployar.** Ahora
      `storage.ts` maneja DOS cosas: los logos de las cotizaciones Y las imágenes
      de los productos manuales. Los dos usos se rompen en Vercel (filesystem
      efímero). Un solo punto de cambio (`saveUploadedFile()`), pero afecta a los
      dos flujos — verificar ambos después de migrar.

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
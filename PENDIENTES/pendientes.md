# PENDIENTES — Proyecto tienda Ganchito Estudio

Cosas identificadas que NO se resuelven ahora, para no perderlas. Se abordan en su
etapa correspondiente (la mayoría en la pasada de diseño final o en el deploy).

---

## Pulido de diseño (pasada final, cuando estén todas las páginas)

- [ ] **Filtros de categoría en mobile:** las 27 categorías apiladas ocupan
      demasiado espacio vertical y empujan los productos hacia abajo. Resolver con
      desplegable, scroll horizontal, o botón "Filtrar" que abra un panel.
- [ ] **Cards de producto se cortan en mobile:** la grilla se va fuera de pantalla
      por el costado derecho (nombres y fotos tapados). Ajustar ancho de columnas /
      padding del contenedor.
- [ ] **Botón "Pedí tu cotización" del header se corta en mobile.** Header necesita
      colapsar bien en pantalla chica (posible menú hamburguesa).
- [ ] **Catálogo en general necesita pulido estético:** espaciados, jerarquía,
      viñeta de las cards. Funciona, pero se ve "crudo".
- [ ] Al ser un patrón reutilizable, la card de producto se usa también en
      "destacados" (home) y "relacionados" (ficha). Pulirla UNA vez y que aplique
      a todos lados.

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
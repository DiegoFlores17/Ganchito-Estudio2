-- ESCRITA A MANO. No usar la que genera `prisma migrate diff` para este cambio.
--
-- Prisma genera esto:
--     ALTER TABLE "product_variants" ADD COLUMN "costPrice" DECIMAL(12,2) NOT NULL;
-- que sobre una tabla con filas falla con "Null constraint failed: (costPrice)"
-- (verificado contra la base local, 1693 variantes).
--
-- El peligro no es esa falla, que es ruidosa: es el arreglo obvio. Agregarle
-- un DEFAULT 0 para que pase deja TODAS las variantes con costo cero, en
-- silencio y sin que nada se rompa hasta que alguien mire un precio.
--
-- Por eso va en cuatro pasos: nullable -> backfill desde el producto ->
-- NOT NULL. El paso 4 actúa de red: si el backfill no cubriera alguna fila,
-- la migración falla ahí en vez de dejar datos a medias.

-- 1. Cotización del dólar. Aditivo simple: la tabla tiene una sola fila y el
--    default la cubre.
ALTER TABLE "pricing_config" ADD COLUMN "usdRate" DECIMAL(12,2) NOT NULL DEFAULT 1510;

-- 2. Costo por variante, NULLABLE por ahora para poder crear la columna.
ALTER TABLE "product_variants" ADD COLUMN "costPrice" DECIMAL(12,2);

-- 3. Backfill: cada variante hereda el costo de su producto. Es exactamente
--    el estado actual del dato (hoy el costo es único por producto), así que
--    esta migración no cambia ningún precio, solo lo mueve de lugar.
UPDATE "product_variants" v
   SET "costPrice" = p."costPrice"
  FROM "products" p
 WHERE v."productId" = p.id;

-- 4. Recién ahora se exige NOT NULL.
ALTER TABLE "product_variants" ALTER COLUMN "costPrice" SET NOT NULL;

-- NOTA: "products"."costPrice" NO se borra acá a propósito. Se elimina en la
-- tanda 3, después de que todo el código lea desde la variante. Mientras
-- tanto el dato queda duplicado, que es la red de seguridad: si algo sale
-- mal en la tanda 2, el precio original sigue estando.

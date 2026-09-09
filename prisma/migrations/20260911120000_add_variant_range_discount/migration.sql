-- Segunda capa de descuento del proveedor, por variante.
--
-- ADITIVA y sin backfill: las cuatro columnas son nullable y los datos vienen
-- de la API de Zecat, asi que EL BACKFILL ES EL RE-SYNC. Por eso es segura de
-- aplicar antes de deployar: el codigo viejo ignora columnas que no conoce, y
-- el nuevo las trata como opcionales.
--
-- Consecuencia buscada: entre la migracion y el re-sync, todas las columnas
-- quedan en NULL y NINGUN precio cambia. Eso da un punto de control — se
-- deploya, se verifica que nada se movio, y recien despues se sincroniza.
--
-- discountPercent usa Decimal(6,2) y no el (12,2) de costPrice: es un
-- porcentaje, no un monto. El maximo real en el catalogo es 41,83.
ALTER TABLE "product_variants"
  ADD COLUMN "discountExternalId" TEXT,
  ADD COLUMN "discountName"       TEXT,
  ADD COLUMN "discountPercent"    DECIMAL(6,2),
  ADD COLUMN "discountTiers"      JSONB;

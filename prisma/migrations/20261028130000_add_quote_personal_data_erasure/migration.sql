-- Registro del borrado de datos personales a pedido del cliente.
-- La cotizacion se anonimiza (no se borra): estas columnas dicen cuando y
-- quien lo hizo. Nullable y sin backfill: ninguna cotizacion existente fue
-- anonimizada todavia.
ALTER TABLE "quotes" ADD COLUMN "personalDataErasedAt" TIMESTAMP(3),
ADD COLUMN "personalDataErasedBy" TEXT;

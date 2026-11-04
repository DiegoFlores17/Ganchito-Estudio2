-- Minimo de compra del proveedor congelado en cada item de cotizacion.
-- Nullable y SIN backfill: las cotizaciones anteriores no guardaron el
-- minimo vigente, y rellenarlas con el valor de hoy seria inventar un dato.
ALTER TABLE "quote_items" ADD COLUMN "minOrderQuantity" INTEGER;

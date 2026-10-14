-- Resumen fijo por corrida (etapa B): lo que quedo al terminar, escrito una
-- sola vez. Aditiva pura: columna nullable, sin default ni backfill. Las
-- corridas anteriores quedan en NULL y el panel muestra "no registrado".

ALTER TABLE "sync_runs" ADD COLUMN "summary" JSONB;

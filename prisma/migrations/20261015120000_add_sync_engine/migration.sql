-- Motor del sync automatico (etapa C). Aditiva pura: tres columnas nullable
-- en sync_runs y un booleano con default en suppliers. Sin backfill.
-- Ojo: desde C, sync_runs.cursor es un indice sobre plannedExternalIds (antes
-- era la ultima pagina): no debe haber corridas RUNNING al aplicarla.

ALTER TABLE "sync_runs" ADD COLUMN "plannedExternalIds" JSONB;
ALTER TABLE "sync_runs" ADD COLUMN "leaseUntil" TIMESTAMP(3);
ALTER TABLE "sync_runs" ADD COLUMN "alertedAt" TIMESTAMP(3);

ALTER TABLE "suppliers" ADD COLUMN "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Auto-pausado de ausentes: registro en sync_runs + umbral configurable por
-- proveedor en suppliers (su primer uso real). Aditiva pura, sin backfill.

ALTER TABLE "sync_runs" ADD COLUMN "autoPausedExternalIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "sync_runs" ADD COLUMN "autoPauseSkipped" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "suppliers" ADD COLUMN "origin" "ProductOrigin";
ALTER TABLE "suppliers" ADD COLUMN "autoPauseMaxPercent" DECIMAL(5,2) NOT NULL DEFAULT 5;
CREATE UNIQUE INDEX "suppliers_origin_key" ON "suppliers"("origin");

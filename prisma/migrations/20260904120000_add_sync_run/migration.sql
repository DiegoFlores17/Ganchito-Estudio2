-- Tabla SyncRun: lock + progreso retomable + historial de sincronizaciones.
-- Aditiva pura (tabla nueva, sin backfill).

CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "provider" "ProductOrigin" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cursor" INTEGER,
    "totalRemote" INTEGER,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "paused" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "usdWarnings" INTEGER NOT NULL DEFAULT 0,
    "seenExternalIds" JSONB NOT NULL DEFAULT '[]',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "missingExternalIds" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_runs_provider_status_idx" ON "sync_runs"("provider", "status");

-- EL LOCK: una sola corrida RUNNING por proveedor, garantizado por la BASE.
-- Indice unico PARCIAL (Prisma no lo puede expresar en el schema): dos
-- "iniciar" simultaneos —doble click, dos admins, boton + consola— chocan
-- aca y gana uno solo. El acquire es "insertar y que la base decida", nunca
-- consultar-y-despues-crear (misma leccion que la colision de slugs).
CREATE UNIQUE INDEX "sync_runs_provider_running_key"
  ON "sync_runs"("provider") WHERE status = 'RUNNING';

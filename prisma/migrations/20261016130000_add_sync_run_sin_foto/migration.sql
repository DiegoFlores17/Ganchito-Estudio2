-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN "sinFotoExternalIds" JSONB NOT NULL DEFAULT '[]';

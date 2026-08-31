-- Quote.publicToken + Quote.shortCode, con backfill para las filas
-- existentes. Escrita a mano (Prisma generaria ADD COLUMN NOT NULL sin
-- default, que falla con filas existentes; el precedente es la migracion de
-- costPrice). Todo en una sola migracion a proposito: el DDL de Postgres es
-- transaccional, asi que ADD -> backfill -> SET NOT NULL queda atomico y no
-- hay ventana con la tabla a medias.

-- 1. Columnas nullables.
ALTER TABLE "quotes" ADD COLUMN "publicToken" TEXT;
ALTER TABLE "quotes" ADD COLUMN "shortCode" TEXT;

-- 2. Backfill.
-- publicToken: 32 hex chars, mismo largo que crypto.randomBytes(16) en hex.
-- md5(random...) y no gen_random_bytes: no depende de la extension pgcrypto,
-- que no esta garantizada en todos los entornos.
UPDATE "quotes"
SET "publicToken" = md5(random()::text || clock_timestamp()::text || id)
WHERE "publicToken" IS NULL;

-- shortCode: 6 chars del charset sin ambiguos (sin O/0/I/1/L), igual que el
-- generador de la app. Loop por fila para que cada una tire sus propios
-- random(); un UPDATE masivo con la misma expresion puede evaluarla una vez.
DO $$
DECLARE
  fila RECORD;
  charset CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  codigo TEXT;
BEGIN
  FOR fila IN SELECT id FROM "quotes" WHERE "shortCode" IS NULL LOOP
    LOOP
      codigo := '';
      FOR i IN 1..6 LOOP
        codigo := codigo || substr(charset, 1 + floor(random() * 31)::int, 1);
      END LOOP;
      -- Reintento por colision: con 31^6 combinaciones y un puñado de filas
      -- no deberia pasar nunca, pero un choque aca abortaria la migracion.
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "quotes" WHERE "shortCode" = codigo);
    END LOOP;
    UPDATE "quotes" SET "shortCode" = codigo WHERE id = fila.id;
  END LOOP;
END $$;

-- 3. NOT NULL + UNIQUE. Si el backfill dejo algo sin cubrir, esto falla
-- ruidoso y la transaccion entera se revierte — la red de seguridad.
ALTER TABLE "quotes" ALTER COLUMN "publicToken" SET NOT NULL;
ALTER TABLE "quotes" ALTER COLUMN "shortCode" SET NOT NULL;

CREATE UNIQUE INDEX "quotes_publicToken_key" ON "quotes"("publicToken");
CREATE UNIQUE INDEX "quotes_shortCode_key" ON "quotes"("shortCode");

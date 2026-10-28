-- Aceptacion de la Politica de privacidad en cada cotizacion.
-- Nullable y SIN backfill: las cotizaciones anteriores al checkbox no
-- aceptaron nada, y rellenarlas seria inventar un consentimiento.
ALTER TABLE "quotes" ADD COLUMN "privacyAcceptedAt" TIMESTAMP(3),
ADD COLUMN "privacyVersion" TEXT;

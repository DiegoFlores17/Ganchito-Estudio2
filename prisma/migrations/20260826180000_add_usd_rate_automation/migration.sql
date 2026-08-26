-- Automatizacion de la cotizacion del dolar.
--
-- Aditiva y reversible. El default MANUAL es lo que hace que aplicarla NO
-- cambie ningun precio: hasta que alguien elija AUTO desde el panel, el job
-- registra el oficial pero no pisa `usdRate`.
--
-- usdRateOfficial / usdRateOfficialAt arrancan NULL: se llenan en la primera
-- consulta exitosa a la API.

-- CreateEnum
CREATE TYPE "UsdRateMode" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "pricing_config" ADD COLUMN     "usdRateMode" "UsdRateMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "usdRateOfficial" DECIMAL(12,2),
ADD COLUMN     "usdRateOfficialAt" TIMESTAMP(3),
ADD COLUMN     "usdRateSource" TEXT,
ADD COLUMN     "usdRateUpdatedAt" TIMESTAMP(3);

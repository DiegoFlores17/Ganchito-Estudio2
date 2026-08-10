/*
  Warnings:

  - You are about to drop the column `marginRate` on the `pricing_config` table. All the data in the column will be lost.
  - You are about to drop the column `usdToArsRate` on the `pricing_config` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "pricing_config" DROP COLUMN "marginRate",
DROP COLUMN "usdToArsRate",
ADD COLUMN     "defaultMarginPercent" DECIMAL(5,2) NOT NULL DEFAULT 45;

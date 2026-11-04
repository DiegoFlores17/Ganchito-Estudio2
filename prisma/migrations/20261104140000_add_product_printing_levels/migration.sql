-- Precios de personalizacion de Zecat (tanda 4a, DATOS): una tabla de niveles
-- (costo interno, en pesos), el recargo bajo el minimo por producto y la lista
-- de productos con niveles rotos/perdidos de cada corrida. Solo aditiva: nada
-- se borra ni se reescribe; las filas existentes quedan con NULL / '[]'.

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "printingUnderMinimumCost" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN     "sinNivelesExternalIds" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "product_printing_levels" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "zecatTypeId" TEXT NOT NULL,
    "technique" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "areaCm2" DECIMAL(10,2),
    "unitCost" DECIMAL(12,2) NOT NULL,
    "setupCost" DECIMAL(12,2) NOT NULL,
    "zecatAreaIds" TEXT[],

    CONSTRAINT "product_printing_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_printing_levels_productId_idx" ON "product_printing_levels"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_printing_levels_productId_zecatTypeId_key" ON "product_printing_levels"("productId", "zecatTypeId");

-- AddForeignKey
ALTER TABLE "product_printing_levels" ADD CONSTRAINT "product_printing_levels_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


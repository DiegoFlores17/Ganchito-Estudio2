-- Personalizacion en la cotizacion (tanda 4b, COTIZADOR): una fila por
-- (cotizacion, producto) con el nivel elegido y sus precios de venta
-- congelados, y la lista de productos cuya seleccion no era valida y se quito.
-- Solo aditiva: las cotizaciones existentes quedan sin filas y con '{}'.

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "printingDroppedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "quote_printings" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "zecatTypeId" TEXT NOT NULL,
    "technique" TEXT NOT NULL,
    "levelLabel" TEXT NOT NULL,
    "publicLabel" TEXT NOT NULL,
    "areaName" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "setupPrice" DECIMAL(12,2) NOT NULL,
    "surcharge" DECIMAL(12,2),
    "estimated" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "quote_printings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_printings_quoteId_idx" ON "quote_printings"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_printings_quoteId_productId_key" ON "quote_printings"("quoteId", "productId");

-- AddForeignKey
ALTER TABLE "quote_printings" ADD CONSTRAINT "quote_printings_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_printings" ADD CONSTRAINT "quote_printings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


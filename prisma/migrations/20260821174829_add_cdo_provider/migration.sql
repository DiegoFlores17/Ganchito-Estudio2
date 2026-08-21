-- Soporte para el segundo proveedor: CDO Promocionales / Stocksur.
--
-- Enteramente aditiva: un valor de enum, tres columnas nullable y una
-- tabla nueva. No transforma ningun dato existente, asi que a diferencia
-- de la migracion del costo por variante, aca el SQL generado por Prisma
-- sirve tal cual.
--
-- Nota sobre el enum: ADD VALUE agrega 'CDO' AL FINAL del orden interno,
-- no en la posicion en que figura en schema.prisma. Solo importaria si
-- ordenaramos por ese campo, cosa que no se hace en ningun lado.

-- AlterEnum
ALTER TYPE "ProductOrigin" ADD VALUE 'CDO';

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "cdoCategoryId" TEXT;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "colorHex" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "cdoId" TEXT;

-- CreateTable
CREATE TABLE "product_attributes" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "iconUrl" TEXT,

    CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_attributes_productId_idx" ON "product_attributes"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_cdoCategoryId_key" ON "categories"("cdoCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "products_cdoId_key" ON "products"("cdoId");

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "products" ADD COLUMN     "featuredRank" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "products_featuredRank_key" ON "products"("featuredRank");

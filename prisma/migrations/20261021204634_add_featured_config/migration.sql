-- CreateTable
CREATE TABLE "featured_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "priceMin" DECIMAL(12,2) NOT NULL DEFAULT 5000,
    "priceMax" DECIMAL(12,2) NOT NULL DEFAULT 15000,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "featured_config_pkey" PRIMARY KEY ("id")
);

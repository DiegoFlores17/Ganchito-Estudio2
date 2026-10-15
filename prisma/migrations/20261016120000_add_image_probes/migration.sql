-- Cache de mediciones de imagenes de proveedor (etapa E). Aditiva pura:
-- una tabla nueva, sin tocar las existentes.

CREATE TABLE "image_probes" (
    "url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_probes_pkey" PRIMARY KEY ("url")
);

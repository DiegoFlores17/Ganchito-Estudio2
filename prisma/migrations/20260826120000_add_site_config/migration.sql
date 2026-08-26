-- Datos de contacto editables desde el panel.
--
-- Tabla nueva, aditiva y reversible (DROP TABLE). No toca ninguna tabla
-- existente. Arranca vacia: la fila id=1 la crea getSiteConfig() la primera
-- vez que alguien la lee.
--
-- Todos los campos son NULL a proposito. Hasta que alguien los cargue desde
-- el panel, el footer simplemente no muestra ese dato — que es mejor que
-- mostrar uno de relleno, como el "+54 9 11 0000-0000" que estuvo
-- hardcodeado hasta hoy.

-- CreateTable
CREATE TABLE "site_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "contactEmail" TEXT,
    "whatsappNumber" TEXT,
    "instagramHandle" TEXT,
    "address" TEXT,
    "openingHours" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_config_pkey" PRIMARY KEY ("id")
);

-- Categoria canonica: unifica las categorias homonimas que traen los dos
-- proveedores (Zecat y CDO traen ambos "Escritura", "Llaveros", "Paraguas",
-- "Tecnologia") bajo una sola categoria propia, que es la que ve el cliente.
--
-- Aditiva y reversible (DROP COLUMN + DROP CONSTRAINT). Arranca toda en NULL:
-- ninguna categoria es alias de otra hasta que alguien lo decida desde el
-- panel, asi que aplicarla no cambia nada de lo que se ve hoy.
--
-- ON DELETE SET NULL y no CASCADE: si algun dia se borra una canonica, sus
-- alias vuelven a ser categorias sueltas. Con CASCADE se borrarian en cadena
-- categorias de proveedor que el conector volveria a crear en el siguiente
-- sync, dejando productos moviendose solos.

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "canonicalId" TEXT;

-- CreateIndex
CREATE INDEX "categories_canonicalId_idx" ON "categories"("canonicalId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_canonicalId_fkey" FOREIGN KEY ("canonicalId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

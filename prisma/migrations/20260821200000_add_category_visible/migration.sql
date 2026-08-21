-- Visibilidad de la categoria como opcion de FILTRO en el catalogo publico.
--
-- Aditiva y reversible (DROP COLUMN). El default true es deliberado: una
-- categoria nueva de un proveedor aparece hasta que alguien decida lo
-- contrario. Al reves, un proveedor nuevo entraria entero invisible y nadie
-- se enteraria.
--
-- OJO: esta columna NO oculta productos. Los productos de una categoria
-- oculta siguen apareciendo en el catalogo y en la busqueda; lo unico que se
-- saca es la categoria del selector de filtro.

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "visible" BOOLEAN NOT NULL DEFAULT true;

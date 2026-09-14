-- Grupo del menu de categorias del header, y marca de revision.
--
-- Las dos columnas son nullable y ninguna toca datos existentes... salvo el
-- UPDATE de abajo, que es deliberado y necesario.
ALTER TABLE "categories" ADD COLUMN "menuGroup"  TEXT;
ALTER TABLE "categories" ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- BACKFILL: todas las categorias que existen HOY quedan marcadas como
-- revisadas.
--
-- No es cosmetico. `reviewedAt IS NULL` es lo que alimenta el aviso de
-- "categorias esperando revision" del panel. Sin este UPDATE, el aviso
-- nace diciendo "27 pendientes" —las que el cliente acaba de ocultar a
-- mano— y queda desacreditado desde el primer dia: si lo primero que
-- muestra es ruido, nadie lo vuelve a mirar.
--
-- El momento de correr esta migracion ES el corte: lo de antes ya se
-- reviso, lo que llegue despues no.
UPDATE "categories" SET "reviewedAt" = NOW();

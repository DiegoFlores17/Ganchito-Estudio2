-- Mensaje pre-escrito de la burbuja flotante de WhatsApp.
--
-- ADITIVA y nullable: el codigo viejo ignora la columna y el nuevo la trata
-- como opcional, asi que es segura de aplicar antes de deployar.
ALTER TABLE "site_config" ADD COLUMN "whatsappMessage" TEXT;

-- Valor inicial, solo donde no hay nada cargado.
--
-- El WHERE no es decorativo: si esta migracion se corriera dos veces (o si
-- alguien ya edito el mensaje entre la migracion y el deploy), un UPDATE sin
-- condicion le pisaria el texto al cliente.
UPDATE "site_config"
   SET "whatsappMessage" = 'Hola, tengo una consulta sobre merchandising'
 WHERE "whatsappMessage" IS NULL;

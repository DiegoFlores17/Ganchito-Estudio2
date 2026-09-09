-- El minimo de compra pasa a salir de minimum_application_quantity (el
-- minimo REAL) y el minimum_order_quantity crudo se conserva aparte.
-- Aditiva pura: la columna nueva la puebla el re-sync, y minOrderQuantity
-- cambia de VALOR (no de tipo) en esa misma corrida.
ALTER TABLE "products" ADD COLUMN "supplierMinOrderQuantity" INTEGER;

BEGIN;

-- El catálogo de códigos lo define el Sistema Nacional: deja de ser un enum fijo del back.
ALTER TABLE "inventario_items" ALTER COLUMN "codigo_sn" TYPE VARCHAR(50) USING "codigo_sn"::text;
DROP TYPE "codigo_recurso_sn";

COMMIT;

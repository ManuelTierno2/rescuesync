BEGIN;

CREATE TYPE "codigo_recurso_sn" AS ENUM ('PARAMEDICO', 'RACION_ALIMENTO', 'AGUA_POTABLE', 'KIT_MEDICO', 'VEHICULO_RESCATE');

ALTER TABLE "inventario_items" ADD COLUMN "codigo_sn" "codigo_recurso_sn";
ALTER TABLE "adjudicaciones" ADD COLUMN "sn_compromiso_id" INTEGER;

CREATE TABLE "ofertas_validacion" (
    "id" UUID NOT NULL,
    "ventana_id" UUID NOT NULL,
    "oferta_id" UUID NOT NULL,
    "resultado" VARCHAR(20) NOT NULL,
    "cantidad_valida" INTEGER NOT NULL,
    "nivel_riesgo_max" VARCHAR(10),
    "disponible" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "apoyo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ofertas_validacion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ofertas_validacion_ventana_id_oferta_id_key" ON "ofertas_validacion"("ventana_id", "oferta_id");
CREATE INDEX "ofertas_validacion_oferta_id_idx" ON "ofertas_validacion"("oferta_id");

ALTER TABLE "ofertas_validacion" ADD CONSTRAINT "ofertas_validacion_ventana_id_fkey"
    FOREIGN KEY ("ventana_id") REFERENCES "ventanas_convocatoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ofertas_validacion" ADD CONSTRAINT "ofertas_validacion_oferta_id_fkey"
    FOREIGN KEY ("oferta_id") REFERENCES "ofertas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

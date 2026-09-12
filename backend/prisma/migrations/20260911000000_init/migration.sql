BEGIN;

CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "rol_usuario" AS ENUM ('MUNICIPIO', 'COORDINADOR', 'ONG', 'AUDITOR');
CREATE TYPE "gravedad" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'CRITICA');
CREATE TYPE "tipo_lote" AS ENUM ('PERSONAL', 'RECURSO');

CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "rol" "rol_usuario" NOT NULL,
    "organizacion" VARCHAR(150) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "emergencias" (
    "id" UUID NOT NULL,
    "creada_por_id" UUID NOT NULL,
    "gravedad" "gravedad" NOT NULL,
    "zona" VARCHAR(200) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "bonita_instance_id" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "emergencias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lotes" (
    "id" UUID NOT NULL,
    "emergencia_id" UUID NOT NULL,
    "tipo" "tipo_lote" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad_requerida" INTEGER NOT NULL,
    "unidad" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lotes_cantidad_positiva" CHECK ("cantidad_requerida" > 0)
);

CREATE TABLE "ofertas" (
    "id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "ong_usuario_id" UUID NOT NULL,
    "cantidad_ofrecida" INTEGER NOT NULL,
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ofertas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ofertas_cantidad_positiva" CHECK ("cantidad_ofrecida" > 0)
);

CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");
CREATE UNIQUE INDEX "emergencias_bonita_instance_id_key" ON "emergencias"("bonita_instance_id");
CREATE INDEX "emergencias_creada_por_id_idx" ON "emergencias"("creada_por_id");
CREATE INDEX "lotes_emergencia_id_idx" ON "lotes"("emergencia_id");
CREATE INDEX "ofertas_lote_id_idx" ON "ofertas"("lote_id");
CREATE INDEX "ofertas_ong_usuario_id_idx" ON "ofertas"("ong_usuario_id");

ALTER TABLE "emergencias" ADD CONSTRAINT "emergencias_creada_por_id_fkey"
    FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_emergencia_id_fkey"
    FOREIGN KEY ("emergencia_id") REFERENCES "emergencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ofertas" ADD CONSTRAINT "ofertas_lote_id_fkey"
    FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ofertas" ADD CONSTRAINT "ofertas_ong_usuario_id_fkey"
    FOREIGN KEY ("ong_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

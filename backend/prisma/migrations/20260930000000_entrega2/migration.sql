BEGIN;

CREATE TYPE "organizacion_tipo" AS ENUM ('MUNICIPIO', 'CENTRO_COORDINADOR', 'ONG', 'AUDITORIA');

CREATE TABLE "organizaciones" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "tipo" "organizacion_tipo" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organizaciones_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "usuarios" ADD COLUMN "password_hash" VARCHAR(100);
ALTER TABLE "usuarios" ADD COLUMN "organizacion_id" UUID;

CREATE TABLE "inventario_items" (
    "id" UUID NOT NULL,
    "ong_usuario_id" UUID NOT NULL,
    "tipo" "tipo_lote" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "unidad" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventario_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventario_items_cantidad_positiva" CHECK ("cantidad" > 0)
);

CREATE TABLE "consorcios" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "creado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consorcios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "consorcio_miembros" (
    "id" UUID NOT NULL,
    "consorcio_id" UUID NOT NULL,
    "ong_usuario_id" UUID NOT NULL,
    CONSTRAINT "consorcio_miembros_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ofertas" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ofertas" ADD COLUMN "consorcio_id" UUID;
ALTER TABLE "ofertas" ADD COLUMN "inventario_item_id" UUID;

CREATE TABLE "ofertas_historial" (
    "id" UUID NOT NULL,
    "oferta_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "cantidad_ofrecida" INTEGER NOT NULL,
    "observaciones" TEXT,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ofertas_historial_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "usuarios_organizacion_id_idx" ON "usuarios"("organizacion_id");
CREATE INDEX "inventario_items_ong_usuario_id_idx" ON "inventario_items"("ong_usuario_id");
CREATE INDEX "consorcios_creado_por_id_idx" ON "consorcios"("creado_por_id");
CREATE UNIQUE INDEX "consorcio_miembros_consorcio_id_ong_usuario_id_key" ON "consorcio_miembros"("consorcio_id", "ong_usuario_id");
CREATE INDEX "consorcio_miembros_ong_usuario_id_idx" ON "consorcio_miembros"("ong_usuario_id");
CREATE INDEX "ofertas_consorcio_id_idx" ON "ofertas"("consorcio_id");
CREATE INDEX "ofertas_inventario_item_id_idx" ON "ofertas"("inventario_item_id");
CREATE INDEX "ofertas_historial_oferta_id_idx" ON "ofertas_historial"("oferta_id");
CREATE INDEX "ofertas_historial_actor_id_idx" ON "ofertas_historial"("actor_id");

ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventario_items" ADD CONSTRAINT "inventario_items_ong_usuario_id_fkey"
    FOREIGN KEY ("ong_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consorcios" ADD CONSTRAINT "consorcios_creado_por_id_fkey"
    FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consorcio_miembros" ADD CONSTRAINT "consorcio_miembros_consorcio_id_fkey"
    FOREIGN KEY ("consorcio_id") REFERENCES "consorcios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consorcio_miembros" ADD CONSTRAINT "consorcio_miembros_ong_usuario_id_fkey"
    FOREIGN KEY ("ong_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ofertas" ADD CONSTRAINT "ofertas_consorcio_id_fkey"
    FOREIGN KEY ("consorcio_id") REFERENCES "consorcios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ofertas" ADD CONSTRAINT "ofertas_inventario_item_id_fkey"
    FOREIGN KEY ("inventario_item_id") REFERENCES "inventario_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ofertas_historial" ADD CONSTRAINT "ofertas_historial_oferta_id_fkey"
    FOREIGN KEY ("oferta_id") REFERENCES "ofertas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ofertas_historial" ADD CONSTRAINT "ofertas_historial_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

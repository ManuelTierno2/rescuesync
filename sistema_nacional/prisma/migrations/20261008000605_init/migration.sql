-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('SISTEMA', 'ONG');

-- CreateEnum
CREATE TYPE "EstadoOng" AS ENUM ('PENDIENTE', 'HABILITADA', 'SUSPENDIDA');

-- CreateEnum
CREATE TYPE "NivelRiesgo" AS ENUM ('BAJO', 'MEDIO', 'ALTO', 'CRITICO');

-- CreateEnum
CREATE TYPE "EstadoCompromiso" AS ENUM ('ACTIVO', 'LIBERADO');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "ongId" INTEGER,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ong" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "estado" "EstadoOng" NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ong_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoRecurso" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,

    CONSTRAINT "TipoRecurso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificacion" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipoRecursoId" INTEGER NOT NULL,
    "nivelRiesgoMax" "NivelRiesgo" NOT NULL,

    CONSTRAINT "Certificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OngCertificacion" (
    "ongId" INTEGER NOT NULL,
    "certificacionId" INTEGER NOT NULL,
    "vencimiento" TIMESTAMP(3),

    CONSTRAINT "OngCertificacion_pkey" PRIMARY KEY ("ongId","certificacionId")
);

-- CreateTable
CREATE TABLE "OngRecurso" (
    "id" SERIAL NOT NULL,
    "ongId" INTEGER NOT NULL,
    "tipoRecursoId" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "bloqueado" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OngRecurso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Compromiso" (
    "id" SERIAL NOT NULL,
    "emergenciaId" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "ongId" INTEGER NOT NULL,
    "estado" "EstadoCompromiso" NOT NULL DEFAULT 'ACTIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liberadoAt" TIMESTAMP(3),

    CONSTRAINT "Compromiso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompromisoItem" (
    "id" SERIAL NOT NULL,
    "compromisoId" INTEGER NOT NULL,
    "tipoRecursoId" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "CompromisoItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_ongId_key" ON "Usuario"("ongId");

-- CreateIndex
CREATE UNIQUE INDEX "Ong_cuit_key" ON "Ong"("cuit");

-- CreateIndex
CREATE UNIQUE INDEX "TipoRecurso_codigo_key" ON "TipoRecurso"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Certificacion_codigo_key" ON "Certificacion"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "OngRecurso_ongId_tipoRecursoId_key" ON "OngRecurso"("ongId", "tipoRecursoId");

-- CreateIndex
CREATE INDEX "Compromiso_emergenciaId_idx" ON "Compromiso"("emergenciaId");

-- CreateIndex
CREATE UNIQUE INDEX "Compromiso_emergenciaId_loteId_ongId_key" ON "Compromiso"("emergenciaId", "loteId", "ongId");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_ongId_fkey" FOREIGN KEY ("ongId") REFERENCES "Ong"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificacion" ADD CONSTRAINT "Certificacion_tipoRecursoId_fkey" FOREIGN KEY ("tipoRecursoId") REFERENCES "TipoRecurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OngCertificacion" ADD CONSTRAINT "OngCertificacion_ongId_fkey" FOREIGN KEY ("ongId") REFERENCES "Ong"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OngCertificacion" ADD CONSTRAINT "OngCertificacion_certificacionId_fkey" FOREIGN KEY ("certificacionId") REFERENCES "Certificacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OngRecurso" ADD CONSTRAINT "OngRecurso_ongId_fkey" FOREIGN KEY ("ongId") REFERENCES "Ong"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OngRecurso" ADD CONSTRAINT "OngRecurso_tipoRecursoId_fkey" FOREIGN KEY ("tipoRecursoId") REFERENCES "TipoRecurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compromiso" ADD CONSTRAINT "Compromiso_ongId_fkey" FOREIGN KEY ("ongId") REFERENCES "Ong"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompromisoItem" ADD CONSTRAINT "CompromisoItem_compromisoId_fkey" FOREIGN KEY ("compromisoId") REFERENCES "Compromiso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompromisoItem" ADD CONSTRAINT "CompromisoItem_tipoRecursoId_fkey" FOREIGN KEY ("tipoRecursoId") REFERENCES "TipoRecurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OngRecurso" ADD CONSTRAINT "OngRecurso_bloqueado_check" CHECK ("bloqueado" >= 0 AND "bloqueado" <= "total");

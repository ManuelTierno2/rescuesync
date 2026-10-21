-- AlterTable
ALTER TABLE "Ong" ALTER COLUMN "cuit" DROP NOT NULL;
ALTER TABLE "Ong" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Ong_externalId_key" ON "Ong"("externalId");

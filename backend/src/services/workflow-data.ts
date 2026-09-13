import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';

export type Db = Prisma.TransactionClient;
// All writes affecting a case acquire this row lock; HTTP always happens outside it.
export async function lockEmergency(tx: Db, emergenciaId: string) {
  await tx.$queryRaw`SELECT id FROM emergencias WHERE id = ${emergenciaId}::uuid FOR UPDATE`;
  const emergency = await tx.emergencia.findUnique({ where: { id: emergenciaId } });
  if (!emergency) throw new AppError(404, 'EMERGENCIA_NOT_FOUND', 'La emergencia no existe.');
  return emergency;
}
export async function currentRound(tx: Db, emergenciaId: string) {
  const existing = await tx.ronda.findFirst({ where: { emergencia_id: emergenciaId }, orderBy: { numero: 'desc' } });
  return existing ?? tx.ronda.create({ data: { emergencia_id: emergenciaId, numero: 1 } });
}
export async function roundCoverage(tx: Db, rondaId: string) {
  const lotes = await tx.lote.findMany({ where: { ronda_id: rondaId }, orderBy: { id: 'asc' },
    include: { ofertas: { where: { activa: true }, select: { cantidad_ofrecida: true } } } });
  const coverage = lotes.map(l => {
    const ofrecida = l.ofertas.reduce((n, o) => n + o.cantidad_ofrecida, 0);
    return { loteId: l.id, cantidadRequerida: l.cantidad_requerida, cantidadOfrecida: ofrecida,
      faltante: Math.max(0, l.cantidad_requerida - ofrecida), cubierto: ofrecida >= l.cantidad_requerida };
  });
  return { rondaId, lotes: coverage, lotesCubiertos: coverage.length > 0 && coverage.every(l => l.cubierto) };
}
export async function calculateCoverage(prisma: PrismaClient, emergenciaId: string) {
  return prisma.$transaction(async tx => {
    await lockEmergency(tx, emergenciaId);
    return roundCoverage(tx, (await currentRound(tx, emergenciaId)).id);
  });
}

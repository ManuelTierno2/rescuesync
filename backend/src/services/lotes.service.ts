import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import type { CrearLoteInput } from '../validators/lotes.schema.js';
import { obtenerEmergencia } from './emergencias.service.js';

export async function obtenerLote(prisma: PrismaClient, id: string) {
  const lote = await prisma.lote.findUnique({ where: { id } });
  if (!lote) throw new AppError(404, 'LOTE_NOT_FOUND', 'El lote no existe.');
  return lote;
}

export async function listarLotes(prisma: PrismaClient, emergenciaId: string) {
  await obtenerEmergencia(prisma, emergenciaId);
  return prisma.lote.findMany({ where: { emergencia_id: emergenciaId }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
}

export async function crearLote(prisma: PrismaClient, emergenciaId: string, input: CrearLoteInput) {
  await obtenerEmergencia(prisma, emergenciaId);
  try {
    return await prisma.lote.create({ data: { ...input, emergencia_id: emergenciaId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new AppError(404, 'EMERGENCIA_NOT_FOUND', 'La emergencia no existe.');
    }
    throw error;
  }
}

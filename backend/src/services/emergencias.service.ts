import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import type { CrearEmergenciaInput } from '../validators/emergencias.schema.js';

export async function crearEmergencia(prisma: PrismaClient, input: CrearEmergenciaInput) {
  const usuario = await prisma.usuario.findUnique({
    where: { id: input.creada_por_id },
    select: { rol: true },
  });
  if (!usuario || usuario.rol !== 'MUNICIPIO') {
    throw new AppError(422, 'INVALID_CREATOR', 'El autor debe ser un usuario municipal existente.');
  }

  try {
    return await prisma.emergencia.create({ data: input });
  } catch (error) {
    // La FK también protege el alta si el usuario se elimina después de la consulta.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new AppError(422, 'INVALID_CREATOR', 'El autor debe ser un usuario municipal existente.');
    }
    throw error;
  }
}

export async function obtenerEmergencia(prisma: PrismaClient, id: string) {
  const emergencia = await prisma.emergencia.findUnique({ where: { id } });
  if (!emergencia) {
    throw new AppError(404, 'EMERGENCIA_NOT_FOUND', 'La emergencia no existe.');
  }
  return emergencia;
}

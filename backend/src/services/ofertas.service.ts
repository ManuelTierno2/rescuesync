import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import type { CrearOfertaInput } from '../validators/ofertas.schema.js';
import { obtenerLote } from './lotes.service.js';
import { usuarioPublicSelect } from './usuarios.service.js';

const include = { ong_usuario: { select: usuarioPublicSelect } };

export async function listarOfertas(prisma: PrismaClient, loteId: string) {
  await obtenerLote(prisma, loteId);
  return prisma.oferta.findMany({ where: { lote_id: loteId }, include, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
}

export async function crearOferta(prisma: PrismaClient, loteId: string, input: CrearOfertaInput) {
  await obtenerLote(prisma, loteId);
  const usuario = await prisma.usuario.findUnique({ where: { id: input.ong_usuario_id }, select: { rol: true } });
  if (!usuario || usuario.rol !== 'ONG') {
    throw new AppError(422, 'INVALID_ONG', 'La oferta debe pertenecer a un usuario ONG existente.');
  }
  try {
    return await prisma.oferta.create({ data: { ...input, lote_id: loteId }, include });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      await obtenerLote(prisma, loteId);
      throw new AppError(422, 'INVALID_ONG', 'La oferta debe pertenecer a un usuario ONG existente.');
    }
    throw error;
  }
}

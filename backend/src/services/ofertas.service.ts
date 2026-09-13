import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import type { CrearOfertaInput } from '../validators/ofertas.schema.js';
import { obtenerLote } from './lotes.service.js';
import { usuarioPublicSelect } from './usuarios.service.js';
import { currentRound, lockEmergency } from './workflow-data.js';

const include = { ong_usuario: { select: usuarioPublicSelect } };

export async function listarOfertas(prisma: PrismaClient, loteId: string) {
  await obtenerLote(prisma, loteId);
  return prisma.oferta.findMany({ where: { lote_id: loteId }, include, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
}

export async function crearOferta(prisma: PrismaClient, loteId: string, input: CrearOfertaInput) {
  const lote = await obtenerLote(prisma, loteId);
  const usuario = await prisma.usuario.findUnique({ where: { id: input.ong_usuario_id }, select: { rol: true } });
  if (!usuario || usuario.rol !== 'ONG') {
    throw new AppError(422, 'INVALID_ONG', 'La oferta debe pertenecer a un usuario ONG existente.');
  }
  try {
    return await prisma.$transaction(async tx => {
      const e = await lockEmergency(tx, lote.emergencia_id);
      const round = await currentRound(tx, e.id);
      if (e.cerrada_at || round.id !== lote.ronda_id || round.seleccionada_at || !round.publicada_at)
        throw new AppError(409, 'CONVOCATORIA_CERRADA', 'El lote no pertenece a una convocatoria abierta.');
      const window = await tx.ventanaConvocatoria.findFirst({ where: { ronda_id: round.id, cerrada_at: null, vence_at: { gt: new Date() } } });
      if (!window) throw new AppError(409, 'CONVOCATORIA_CERRADA', 'La ventana de convocatoria no está abierta.');
      return tx.oferta.create({ data: { ...input, lote_id: loteId }, include });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      await obtenerLote(prisma, loteId);
      throw new AppError(422, 'INVALID_ONG', 'La oferta debe pertenecer a un usuario ONG existente.');
    }
    throw error;
  }
}

import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import type { ActualizarOfertaInput, CrearOfertaInput } from '../validators/ofertas.schema.js';
import { obtenerLote } from './lotes.service.js';
import { usuarioPublicSelect } from './usuarios.service.js';
import { currentRound, lockEmergency } from './workflow-data.js';

const include = { ong_usuario: { select: usuarioPublicSelect } };

async function assertOpenWindow(tx: Prisma.TransactionClient, lote: { emergencia_id: string; ronda_id: string | null }) {
  const e = await lockEmergency(tx, lote.emergencia_id);
  const round = await currentRound(tx, e.id);
  if (e.cerrada_at || round.id !== lote.ronda_id || round.seleccionada_at || !round.publicada_at)
    throw new AppError(409, 'CONVOCATORIA_CERRADA', 'El lote no pertenece a una convocatoria abierta.');
  const window = await tx.ventanaConvocatoria.findFirst({ where: { ronda_id: round.id, cerrada_at: null, vence_at: { gt: new Date() } } });
  if (!window) throw new AppError(409, 'CONVOCATORIA_CERRADA', 'La ventana de convocatoria no está abierta.');
  return { e, round, window };
}

async function validateConsorcio(tx: Prisma.TransactionClient, consorcioId: string | null | undefined, ongUsuarioId: string) {
  if (!consorcioId) return;
  const member = await tx.consorcioMiembro.findUnique({
    where: { consorcio_id_ong_usuario_id: { consorcio_id: consorcioId, ong_usuario_id: ongUsuarioId } },
  });
  if (!member) throw new AppError(422, 'INVALID_CONSORCIO', 'El consorcio no existe o no pertenece al usuario ONG.');
}

async function validateInventario(tx: Prisma.TransactionClient, itemId: string | null | undefined, ongUsuarioId: string, cantidad: number) {
  if (!itemId) return;
  const item = await tx.inventarioItem.findUnique({ where: { id: itemId } });
  if (!item || item.ong_usuario_id !== ongUsuarioId) {
    throw new AppError(422, 'INVALID_INVENTARIO', 'El ítem de inventario no existe o no pertenece al usuario ONG.');
  }
  if (item.cantidad < cantidad) {
    throw new AppError(422, 'INSUFFICIENT_STOCK', 'La cantidad ofrecida supera el stock del inventario.');
  }
}

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
      await assertOpenWindow(tx, lote);
      await validateConsorcio(tx, input.consorcio_id, input.ong_usuario_id);
      await validateInventario(tx, input.inventario_item_id, input.ong_usuario_id, input.cantidad_ofrecida);
      const oferta = await tx.oferta.create({
        data: {
          lote_id: loteId,
          ong_usuario_id: input.ong_usuario_id,
          cantidad_ofrecida: input.cantidad_ofrecida,
          observaciones: input.observaciones,
          version: 1,
          consorcio_id: input.consorcio_id,
          inventario_item_id: input.inventario_item_id,
        },
        include,
      });
      await tx.ofertaHistorial.create({
        data: {
          oferta_id: oferta.id,
          version: 1,
          cantidad_ofrecida: oferta.cantidad_ofrecida,
          observaciones: oferta.observaciones,
          actor_id: input.ong_usuario_id,
        },
      });
      return oferta;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      await obtenerLote(prisma, loteId);
      throw new AppError(422, 'INVALID_ONG', 'La oferta debe pertenecer a un usuario ONG existente.');
    }
    throw error;
  }
}

export async function actualizarOferta(prisma: PrismaClient, ofertaId: string, actorId: string, input: ActualizarOfertaInput) {
  return prisma.$transaction(async tx => {
    const oferta = await tx.oferta.findUnique({
      where: { id: ofertaId },
      include: { lote: true, adjudicacion: true },
    });
    if (!oferta) throw new AppError(404, 'OFERTA_NOT_FOUND', 'Oferta no encontrada.');
    if (oferta.ong_usuario_id !== actorId) {
      throw new AppError(403, 'FORBIDDEN_OWNER', 'Solo el dueño de la oferta puede editarla.');
    }
    if (!oferta.activa || oferta.adjudicacion) {
      throw new AppError(409, 'OFERTA_LOCKED', 'La oferta no puede editarse porque está inactiva o adjudicada.');
    }
    await assertOpenWindow(tx, oferta.lote);
    await validateInventario(tx, oferta.inventario_item_id, actorId, input.cantidad_ofrecida);
    const version = oferta.version + 1;
    const updated = await tx.oferta.update({
      where: { id: ofertaId },
      data: {
        cantidad_ofrecida: input.cantidad_ofrecida,
        observaciones: input.observaciones,
        version,
      },
      include,
    });
    await tx.ofertaHistorial.create({
      data: {
        oferta_id: ofertaId,
        version,
        cantidad_ofrecida: input.cantidad_ofrecida,
        observaciones: input.observaciones,
        actor_id: actorId,
      },
    });
    return updated;
  });
}

export async function listarHistorialOferta(prisma: PrismaClient, ofertaId: string) {
  const oferta = await prisma.oferta.findUnique({ where: { id: ofertaId }, select: { id: true } });
  if (!oferta) throw new AppError(404, 'OFERTA_NOT_FOUND', 'Oferta no encontrada.');
  return prisma.ofertaHistorial.findMany({
    where: { oferta_id: ofertaId },
    include: { actor: { select: usuarioPublicSelect } },
    orderBy: [{ version: 'asc' }, { created_at: 'asc' }],
  });
}

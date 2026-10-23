import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import type { ActualizarInventarioInput, CrearInventarioInput } from '../validators/inventario.schema.js';
import type { CatalogoSnService } from './catalogo-sn.service.js';

export async function listarInventario(prisma: PrismaClient, ongUsuarioId: string) {
  return prisma.inventarioItem.findMany({
    where: { ong_usuario_id: ongUsuarioId },
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
  });
}

export async function crearInventario(
  prisma: PrismaClient,
  ongUsuarioId: string,
  input: CrearInventarioInput,
  catalogo: CatalogoSnService,
) {
  const { codigoSn, ...rest } = input;
  await catalogo.validar(codigoSn);
  return prisma.inventarioItem.create({
    data: { ...rest, codigo_sn: codigoSn, ong_usuario_id: ongUsuarioId },
  });
}

export async function actualizarInventario(
  prisma: PrismaClient,
  itemId: string,
  ongUsuarioId: string,
  input: ActualizarInventarioInput,
  catalogo: CatalogoSnService,
) {
  const item = await prisma.inventarioItem.findUnique({ where: { id: itemId } });
  if (!item) throw new AppError(404, 'INVENTARIO_NOT_FOUND', 'Ítem de inventario no encontrado.');
  if (item.ong_usuario_id !== ongUsuarioId) {
    throw new AppError(403, 'FORBIDDEN_OWNER', 'Solo el dueño puede editar el inventario.');
  }
  const { codigoSn, ...rest } = input;
  if (codigoSn !== undefined) await catalogo.validar(codigoSn);
  return prisma.inventarioItem.update({
    where: { id: itemId },
    data: { ...rest, ...(codigoSn !== undefined ? { codigo_sn: codigoSn } : {}) },
  });
}

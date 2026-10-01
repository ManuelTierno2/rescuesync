import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import type { ActualizarInventarioInput, CrearInventarioInput } from '../validators/inventario.schema.js';

export async function listarInventario(prisma: PrismaClient, ongUsuarioId: string) {
  return prisma.inventarioItem.findMany({
    where: { ong_usuario_id: ongUsuarioId },
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
  });
}

export async function crearInventario(prisma: PrismaClient, ongUsuarioId: string, input: CrearInventarioInput) {
  return prisma.inventarioItem.create({
    data: { ...input, ong_usuario_id: ongUsuarioId },
  });
}

export async function actualizarInventario(
  prisma: PrismaClient,
  itemId: string,
  ongUsuarioId: string,
  input: ActualizarInventarioInput,
) {
  const item = await prisma.inventarioItem.findUnique({ where: { id: itemId } });
  if (!item) throw new AppError(404, 'INVENTARIO_NOT_FOUND', 'Ítem de inventario no encontrado.');
  if (item.ong_usuario_id !== ongUsuarioId) {
    throw new AppError(403, 'FORBIDDEN_OWNER', 'Solo el dueño puede editar el inventario.');
  }
  return prisma.inventarioItem.update({ where: { id: itemId }, data: input });
}

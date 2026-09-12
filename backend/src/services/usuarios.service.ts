import type { PrismaClient } from '../generated/prisma/client.js';

export const usuarioPublicSelect = { id: true, nombre: true, organizacion: true, rol: true } as const;

export async function listarUsuarios(prisma: PrismaClient) {
  return prisma.usuario.findMany({ select: usuarioPublicSelect, orderBy: [{ rol: 'asc' }, { nombre: 'asc' }, { id: 'asc' }] });
}

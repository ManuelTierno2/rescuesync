import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import type { CrearOrganizacionInput } from '../validators/organizaciones.schema.js';

export async function listarOrganizaciones(prisma: PrismaClient) {
  return prisma.organizacion.findMany({ orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }, { id: 'asc' }] });
}

export async function crearOrganizacion(prisma: PrismaClient, input: CrearOrganizacionInput) {
  return prisma.organizacion.create({ data: input });
}

export async function obtenerOrganizacion(prisma: PrismaClient, id: string) {
  const org = await prisma.organizacion.findUnique({ where: { id } });
  if (!org) throw new AppError(404, 'ORGANIZACION_NOT_FOUND', 'Organización no encontrada.');
  return org;
}

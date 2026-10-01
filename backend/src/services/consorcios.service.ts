import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import { usuarioPublicSelect } from './usuarios.service.js';
import type { CrearConsorcioInput } from '../validators/consorcios.schema.js';

const include = {
  miembros: {
    include: { ong_usuario: { select: usuarioPublicSelect } },
  },
  creado_por: { select: usuarioPublicSelect },
};

async function assertOngUsers(prisma: PrismaClient, ids: string[]) {
  const users = await prisma.usuario.findMany({
    where: { id: { in: ids }, rol: 'ONG' },
    select: { id: true },
  });
  if (users.length !== new Set(ids).size) {
    throw new AppError(422, 'INVALID_ONG', 'Todos los miembros deben ser usuarios ONG existentes.');
  }
}

export async function listarConsorcios(prisma: PrismaClient, ongUsuarioId: string) {
  return prisma.consorcio.findMany({
    where: {
      OR: [
        { creado_por_id: ongUsuarioId },
        { miembros: { some: { ong_usuario_id: ongUsuarioId } } },
      ],
    },
    include,
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
  });
}

export async function crearConsorcio(prisma: PrismaClient, creadorId: string, input: CrearConsorcioInput) {
  const miembroIds = [...new Set([creadorId, ...input.miembroIds])];
  await assertOngUsers(prisma, miembroIds);
  return prisma.consorcio.create({
    data: {
      nombre: input.nombre,
      creado_por_id: creadorId,
      miembros: {
        create: miembroIds.map((ong_usuario_id) => ({ ong_usuario_id })),
      },
    },
    include,
  });
}

export async function agregarMiembro(prisma: PrismaClient, consorcioId: string, actorId: string, ongUsuarioId: string) {
  const consorcio = await prisma.consorcio.findUnique({
    where: { id: consorcioId },
    include: { miembros: true },
  });
  if (!consorcio) throw new AppError(404, 'CONSORCIO_NOT_FOUND', 'Consorcio no encontrado.');
  const isMember = consorcio.creado_por_id === actorId
    || consorcio.miembros.some((m) => m.ong_usuario_id === actorId);
  if (!isMember) throw new AppError(403, 'FORBIDDEN_OWNER', 'Solo miembros del consorcio pueden agregar participantes.');
  await assertOngUsers(prisma, [ongUsuarioId]);
  try {
    await prisma.consorcioMiembro.create({
      data: { consorcio_id: consorcioId, ong_usuario_id: ongUsuarioId },
    });
  } catch {
    throw new AppError(409, 'ALREADY_MEMBER', 'El usuario ya es miembro del consorcio.');
  }
  return prisma.consorcio.findUniqueOrThrow({ where: { id: consorcioId }, include });
}

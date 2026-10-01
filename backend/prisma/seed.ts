import { pathToFileURL } from 'node:url';
import type { PrismaClient, RolUsuario, OrganizacionTipo } from '../src/generated/prisma/client.js';
import { createPrismaClient } from '../src/database/prisma.js';
import { readEnv } from '../src/config/env.js';
import { hashPassword } from '../src/services/auth.service.js';

export const MUNICIPIO_DEMO_ID = '11111111-1111-4111-8111-111111111111';
export const COORDINADOR_DEMO_ID = '22222222-2222-4222-8222-222222222222';
export const ONG_A_DEMO_ID = '33333333-3333-4333-8333-333333333333';
export const ONG_B_DEMO_ID = '44444444-4444-4444-8444-444444444444';
export const AUDITOR_DEMO_ID = '55555555-5555-4555-8555-555555555555';

export const ORG_MUNICIPIO_ID = '61111111-1111-4111-8111-111111111111';
export const ORG_COORDINADOR_ID = '62222222-2222-4222-8222-222222222222';
export const ORG_ONG_A_ID = '63333333-3333-4333-8333-333333333333';
export const ORG_ONG_B_ID = '64444444-4444-4444-8444-444444444444';
export const ORG_AUDITOR_ID = '65555555-5555-4555-8555-555555555555';

export const DEMO_PASSWORD = 'demo1234';

async function upsertOrg(
  prisma: PrismaClient,
  id: string,
  nombre: string,
  tipo: OrganizacionTipo,
) {
  return prisma.organizacion.upsert({
    where: { id },
    update: { nombre, tipo },
    create: { id, nombre, tipo },
  });
}

async function upsertUser(
  prisma: PrismaClient,
  data: {
    id: string;
    nombre: string;
    email: string;
    rol: RolUsuario;
    organizacion: string;
    orgId: string;
  },
  hash: string,
) {
  const existing = await prisma.usuario.findUnique({ where: { id: data.id } });
  if (existing) {
    const patch: { password_hash?: string; organizacion_id?: string } = {};
    if (!existing.password_hash) patch.password_hash = hash;
    if (!existing.organizacion_id) patch.organizacion_id = data.orgId;
    if (Object.keys(patch).length > 0) {
      return prisma.usuario.update({ where: { id: data.id }, data: patch });
    }
    return existing;
  }
  return prisma.usuario.create({
    data: {
      id: data.id,
      nombre: data.nombre,
      email: data.email,
      rol: data.rol,
      organizacion: data.organizacion,
      organizacion_id: data.orgId,
      password_hash: hash,
    },
  });
}

export async function seedMunicipio(prisma: PrismaClient, passwordHash?: string) {
  const hash = passwordHash ?? await hashPassword(DEMO_PASSWORD);
  await upsertOrg(prisma, ORG_MUNICIPIO_ID, 'Municipio de prueba', 'MUNICIPIO');
  return upsertUser(prisma, {
    id: MUNICIPIO_DEMO_ID,
    nombre: 'Operador municipal de prueba',
    email: 'municipio@rescuesync.test',
    rol: 'MUNICIPIO',
    organizacion: 'Municipio de prueba',
    orgId: ORG_MUNICIPIO_ID,
  }, hash);
}

export async function seedUsuarios(prisma: PrismaClient) {
  const hash = await hashPassword(DEMO_PASSWORD);
  const municipio = await seedMunicipio(prisma, hash);
  const users = [municipio];
  for (const data of [
    {
      id: COORDINADOR_DEMO_ID,
      orgId: ORG_COORDINADOR_ID,
      nombre: 'Coordinador de prueba',
      email: 'coordinador@rescuesync.test',
      rol: 'COORDINADOR' as const,
      organizacion: 'Centro Coordinador',
      orgTipo: 'CENTRO_COORDINADOR' as const,
    },
    {
      id: ONG_A_DEMO_ID,
      orgId: ORG_ONG_A_ID,
      nombre: 'Operador ONG A',
      email: 'ong.a@rescuesync.test',
      rol: 'ONG' as const,
      organizacion: 'ONG A',
      orgTipo: 'ONG' as const,
    },
    {
      id: ONG_B_DEMO_ID,
      orgId: ORG_ONG_B_ID,
      nombre: 'Operador ONG B',
      email: 'ong.b@rescuesync.test',
      rol: 'ONG' as const,
      organizacion: 'ONG B',
      orgTipo: 'ONG' as const,
    },
    {
      id: AUDITOR_DEMO_ID,
      orgId: ORG_AUDITOR_ID,
      nombre: 'Auditor de prueba',
      email: 'auditor@rescuesync.test',
      rol: 'AUDITOR' as const,
      organizacion: 'Auditoría',
      orgTipo: 'AUDITORIA' as const,
    },
  ]) {
    await upsertOrg(prisma, data.orgId, data.organizacion, data.orgTipo);
    users.push(await upsertUser(prisma, {
      id: data.id,
      nombre: data.nombre,
      email: data.email,
      rol: data.rol,
      organizacion: data.organizacion,
      orgId: data.orgId,
    }, hash));
  }
  return users;
}

async function main() {
  const prisma = createPrismaClient(readEnv().DATABASE_URL);
  try {
    const usuarios = await seedUsuarios(prisma);
    console.log(`Usuarios de desarrollo disponibles: ${usuarios.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('No se pudo cargar el usuario de prueba. Revisar la conexión y las migraciones.');
    process.exitCode = 1;
  });
}

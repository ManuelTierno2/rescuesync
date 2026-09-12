import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrismaClient } from '../src/database/prisma.js';
import { readEnv } from '../src/config/env.js';

export const MUNICIPIO_DEMO_ID = '11111111-1111-4111-8111-111111111111';
export const COORDINADOR_DEMO_ID = '22222222-2222-4222-8222-222222222222';
export const ONG_A_DEMO_ID = '33333333-3333-4333-8333-333333333333';
export const ONG_B_DEMO_ID = '44444444-4444-4444-8444-444444444444';
export const AUDITOR_DEMO_ID = '55555555-5555-4555-8555-555555555555';

export async function seedMunicipio(prisma: PrismaClient) {
  return prisma.usuario.upsert({
    where: { id: MUNICIPIO_DEMO_ID },
    update: {},
    create: {
      id: MUNICIPIO_DEMO_ID,
      nombre: 'Operador municipal de prueba',
      email: 'municipio@rescuesync.test',
      rol: 'MUNICIPIO',
      organizacion: 'Municipio de prueba',
    },
  });
}

export async function seedUsuarios(prisma: PrismaClient) {
  const municipio = await seedMunicipio(prisma);
  const users = [municipio];
  for (const data of [
    { id: COORDINADOR_DEMO_ID, nombre: 'Coordinador de prueba', email: 'coordinador@rescuesync.test', rol: 'COORDINADOR' as const, organizacion: 'Centro Coordinador' },
    { id: ONG_A_DEMO_ID, nombre: 'Operador ONG A', email: 'ong.a@rescuesync.test', rol: 'ONG' as const, organizacion: 'ONG A' },
    { id: ONG_B_DEMO_ID, nombre: 'Operador ONG B', email: 'ong.b@rescuesync.test', rol: 'ONG' as const, organizacion: 'ONG B' },
    { id: AUDITOR_DEMO_ID, nombre: 'Auditor de prueba', email: 'auditor@rescuesync.test', rol: 'AUDITOR' as const, organizacion: 'Auditoría' },
  ]) users.push(await prisma.usuario.upsert({ where: { id: data.id }, update: {}, create: data }));
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

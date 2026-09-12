import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrismaClient } from '../src/database/prisma.js';
import { readEnv } from '../src/config/env.js';

export const MUNICIPIO_DEMO_ID = '11111111-1111-4111-8111-111111111111';

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

async function main() {
  const prisma = createPrismaClient(readEnv().DATABASE_URL);
  try {
    const usuario = await seedMunicipio(prisma);
    console.log(`Usuario municipal de prueba: ${usuario.id}`);
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

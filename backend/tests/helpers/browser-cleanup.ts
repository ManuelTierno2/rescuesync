import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createPrismaClient } from '../../src/database/prisma.js';
import { testDatabaseUrl } from './test-database.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const prefix = process.env.BROWSER_TEST_RUN_ID;
if (!prefix || !/^E2E-[0-9a-f-]{36}$/.test(prefix)) throw new Error('Missing isolated browser test run ID');
const prisma = createPrismaClient(testDatabaseUrl());
try {
  const records = await prisma.emergencia.findMany({ where: { zona: { startsWith: prefix } }, select: { id: true } });
  const ids = records.map((record) => record.id);
  await prisma.$transaction([
    prisma.oferta.deleteMany({ where: { lote: { emergencia_id: { in: ids } } } }),
    prisma.lote.deleteMany({ where: { emergencia_id: { in: ids } } }),
    prisma.emergencia.deleteMany({ where: { id: { in: ids } } }),
  ]);
} finally { await prisma.$disconnect(); }

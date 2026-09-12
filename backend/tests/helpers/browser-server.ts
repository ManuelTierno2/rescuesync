import { createServer } from 'node:http';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../../src/app.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { seedUsuarios } from '../../prisma/seed.js';
import { testDatabaseUrl } from './test-database.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const databaseUrl = testDatabaseUrl();
const prisma = createPrismaClient(databaseUrl);
await promisify(execFile)(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  cwd: fileURLToPath(new URL('../../', import.meta.url)),
  env: { ...process.env, BONITA_ENABLED: 'false', DATABASE_URL: databaseUrl }, windowsHide: true,
});
await seedUsuarios(prisma);
const server = createServer(createApp(prisma));
server.listen(3001, '127.0.0.1', () => console.log('Browser test API ready on 3001'));
const shutdown = () => server.close(() => { void prisma.$disconnect(); });
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

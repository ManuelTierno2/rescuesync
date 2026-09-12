import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from './app.js';
import { readEnv } from './config/env.js';
import { createPrismaClient } from './database/prisma.js';

async function main() {
  const env = readEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);

  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    const server = createServer(createApp(prisma));
    server.listen(env.PORT);
    await once(server, 'listening');
    console.log(`RescueSync disponible en http://localhost:${env.PORT}`);

    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      const timeout = setTimeout(() => process.exit(1), 10000).unref();
      server.close(() => {
        void prisma.$disconnect().then(() => {
          clearTimeout(timeout);
          process.exitCode = 0;
        }).catch(() => process.exit(1));
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}

main().catch(() => {
  console.error('No se pudo iniciar RescueSync. Revisar las variables de entorno, PostgreSQL, las migraciones y el puerto.');
  process.exitCode = 1;
});

import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from './app.js';
import { readEnv, EnvError } from './config/env.js';
import { createPrismaClient } from './database/prisma.js';
import { createBonitaService } from './integrations/bonita/bonita.service.js';

async function main() {
  const env = readEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);

  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    const server = createServer(createApp(prisma, createBonitaService(env.bonita), {
      compatibleProcessIds: env.BONITA_WORKFLOW_PROCESS_IDS.split(',').map(id => id.trim()).filter(Boolean),
      callbackSecret: env.BONITA_CALLBACK_SECRET, validationMode: env.OFERTAS_VALIDACION_MODE,
    }));
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

main().catch((error: unknown) => {
  console.error(error instanceof EnvError ? error.message
    : 'No se pudo iniciar RescueSync. Revisar las variables de entorno, PostgreSQL, las migraciones y el puerto.');
  process.exitCode = 1;
});

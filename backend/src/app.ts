import express from 'express';
import type { PrismaClient } from './generated/prisma/client.js';
import { createEmergenciasRouter } from './routes/emergencias.routes.js';
import { notFound } from './middlewares/not-found.js';
import { errorHandler } from './middlewares/error-handler.js';

export function createApp(prisma: PrismaClient) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/emergencias', createEmergenciasRouter(prisma));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

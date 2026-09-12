import express from 'express';
import cors from 'cors';
import type { PrismaClient } from './generated/prisma/client.js';
import { createEmergenciasRouter } from './routes/emergencias.routes.js';
import { notFound } from './middlewares/not-found.js';
import { errorHandler } from './middlewares/error-handler.js';
import type { BonitaService } from './integrations/bonita/bonita.service.js';
import { createUsuariosRouter } from './routes/usuarios.routes.js';
import { createOfertasRouter } from './routes/ofertas.routes.js';

export function createApp(prisma: PrismaClient, bonita?: BonitaService) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: 'http://localhost:5173', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/usuarios', createUsuariosRouter(prisma));
  app.use('/api/emergencias', createEmergenciasRouter(prisma, bonita));
  app.use('/api/lotes/:loteId/ofertas', createOfertasRouter(prisma));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

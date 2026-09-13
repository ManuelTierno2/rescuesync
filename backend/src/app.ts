import express from 'express';
import cors from 'cors';
import type { PrismaClient } from './generated/prisma/client.js';
import { createEmergenciasRouter } from './routes/emergencias.routes.js';
import { notFound } from './middlewares/not-found.js';
import { errorHandler } from './middlewares/error-handler.js';
import type { BonitaService } from './integrations/bonita/bonita.service.js';
import { createUsuariosRouter } from './routes/usuarios.routes.js';
import { createOfertasRouter } from './routes/ofertas.routes.js';
import { createBonitaService } from './integrations/bonita/bonita.service.js';
import { createWorkflowRouter, createBonitaCallbacks } from './routes/workflow.routes.js';
import { defaultWorkflowOptions, type WorkflowOptions } from './services/workflow.service.js';

export function createApp(prisma: PrismaClient, bonita: BonitaService = createBonitaService(), workflowOptions: WorkflowOptions = defaultWorkflowOptions, frontendOrigin = 'http://localhost:5173') {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: frontendOrigin, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'X-Dev-User-Id'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/usuarios', createUsuariosRouter(prisma));
  app.use('/api/internal/bonita', createBonitaCallbacks(prisma, bonita, workflowOptions));
  app.use('/api/emergencias/:id', createWorkflowRouter(prisma, bonita, workflowOptions));
  app.use('/api/emergencias', createEmergenciasRouter(prisma, bonita));
  app.use('/api/lotes/:loteId/ofertas', createOfertasRouter(prisma));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

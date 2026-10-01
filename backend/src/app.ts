import express from 'express';
import cors from 'cors';
import type { PrismaClient } from './generated/prisma/client.js';
import { createEmergenciasRouter } from './routes/emergencias.routes.js';
import { notFound } from './middlewares/not-found.js';
import { errorHandler } from './middlewares/error-handler.js';
import type { BonitaService } from './integrations/bonita/bonita.service.js';
import { createUsuariosRouter } from './routes/usuarios.routes.js';
import { createOfertaItemRouter, createOfertasRouter } from './routes/ofertas.routes.js';
import { createBonitaService } from './integrations/bonita/bonita.service.js';
import { createWorkflowRouter, createBonitaCallbacks } from './routes/workflow.routes.js';
import { defaultWorkflowOptions, type WorkflowOptions } from './services/workflow.service.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createOrganizacionesRouter } from './routes/organizaciones.routes.js';
import { createInventarioRouter } from './routes/inventario.routes.js';
import { createConsorciosRouter } from './routes/consorcios.routes.js';
import { readAuthConfig, type AuthConfig } from './config/env.js';

export function createApp(
  prisma: PrismaClient,
  bonita: BonitaService = createBonitaService(),
  workflowOptions: WorkflowOptions = defaultWorkflowOptions,
  frontendOrigin = 'http://localhost:5173',
  authConfig: AuthConfig = readAuthConfig(),
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    origin: frontendOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Dev-User-Id'],
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/auth', createAuthRouter(prisma, authConfig));
  app.use('/api/usuarios', createUsuariosRouter(prisma));
  app.use('/api/organizaciones', createOrganizacionesRouter(prisma, authConfig));
  app.use('/api/inventario', createInventarioRouter(prisma, authConfig));
  app.use('/api/consorcios', createConsorciosRouter(prisma, authConfig));
  app.use('/api/internal/bonita', createBonitaCallbacks(prisma, bonita, workflowOptions));
  app.use('/api/emergencias/:id', createWorkflowRouter(prisma, bonita, workflowOptions, authConfig));
  app.use('/api/emergencias', createEmergenciasRouter(prisma, bonita, authConfig));
  app.use('/api/lotes/:loteId/ofertas', createOfertasRouter(prisma, authConfig));
  app.use('/api/ofertas', createOfertaItemRouter(prisma, authConfig));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

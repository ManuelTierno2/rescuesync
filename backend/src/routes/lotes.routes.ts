import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createLotesController } from '../controllers/lotes.controller.js';
import { validate } from '../middlewares/validate.js';
import { crearLoteSchema, emergenciaLotesParamsSchema } from '../validators/lotes.schema.js';
import { createAuthMiddleware } from '../middlewares/auth.js';
import type { AuthConfig } from '../config/env.js';
import { readAuthConfig } from '../config/env.js';

export function createLotesRouter(prisma: PrismaClient, authConfig: AuthConfig = readAuthConfig()) {
  const router = Router({ mergeParams: true });
  const controller = createLotesController(prisma);
  const { requireRole } = createAuthMiddleware(prisma, authConfig);
  router.get('/', validate(emergenciaLotesParamsSchema, 'params'), controller.listar);
  router.post(
    '/',
    validate(emergenciaLotesParamsSchema, 'params'),
    validate(crearLoteSchema, 'body'),
    requireRole('COORDINADOR'),
    controller.crear,
  );
  return router;
}

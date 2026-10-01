import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createOfertasController } from '../controllers/ofertas.controller.js';
import { validate } from '../middlewares/validate.js';
import { createAuthMiddleware } from '../middlewares/auth.js';
import {
  actualizarOfertaSchema,
  crearOfertaSchema,
  loteOfertasParamsSchema,
  ofertaIdParamsSchema,
} from '../validators/ofertas.schema.js';
import type { AuthConfig } from '../config/env.js';
import { readAuthConfig } from '../config/env.js';

export function createOfertasRouter(prisma: PrismaClient, authConfig: AuthConfig = readAuthConfig()) {
  const router = Router({ mergeParams: true });
  const controller = createOfertasController(prisma);
  const { requireAuth, requireRole } = createAuthMiddleware(prisma, authConfig);
  router.get('/', validate(loteOfertasParamsSchema, 'params'), controller.listar);
  router.post(
    '/',
    validate(loteOfertasParamsSchema, 'params'),
    requireRole('ONG'),
    validate(crearOfertaSchema, 'body'),
    controller.crear,
  );
  return router;
}

export function createOfertaItemRouter(prisma: PrismaClient, authConfig: AuthConfig = readAuthConfig()) {
  const router = Router();
  const controller = createOfertasController(prisma);
  const { requireAuth, requireRole } = createAuthMiddleware(prisma, authConfig);
  router.patch(
    '/:id',
    requireRole('ONG'),
    validate(ofertaIdParamsSchema, 'params'),
    validate(actualizarOfertaSchema, 'body'),
    controller.actualizar,
  );
  router.get('/:id/historial', requireAuth, validate(ofertaIdParamsSchema, 'params'), controller.historial);
  return router;
}

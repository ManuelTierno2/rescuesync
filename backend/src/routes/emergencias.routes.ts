import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createEmergenciasController } from '../controllers/emergencias.controller.js';
import { validate } from '../middlewares/validate.js';
import { crearEmergenciaSchema, emergenciaIdSchema } from '../validators/emergencias.schema.js';
import type { BonitaService } from '../integrations/bonita/bonita.service.js';
import { createLotesRouter } from './lotes.routes.js';
import { createAuthMiddleware } from '../middlewares/auth.js';
import { AppError } from '../errors/app-error.js';
import type { AuthConfig } from '../config/env.js';
import { readAuthConfig } from '../config/env.js';
import type { CrearEmergenciaInput } from '../validators/emergencias.schema.js';

export function createEmergenciasRouter(
  prisma: PrismaClient,
  bonita?: BonitaService,
  authConfig: AuthConfig = readAuthConfig(),
) {
  const router = Router();
  const controller = createEmergenciasController(prisma, bonita);
  const { requireAuth } = createAuthMiddleware(prisma, authConfig);
  router.get('/', controller.listar);
  router.use('/:emergenciaId/lotes', createLotesRouter(prisma, authConfig));
  router.post('/', requireAuth, validate(crearEmergenciaSchema, 'body'), (req, res, next) => {
    const input = res.locals.body as CrearEmergenciaInput;
    if (req.user!.id !== input.creada_por_id) {
      return next(new AppError(403, 'FORBIDDEN_OWNER', 'La emergencia debe pertenecer al usuario autenticado.'));
    }
    return controller.crear(req, res, next);
  });
  router.get('/:id', validate(emergenciaIdSchema, 'params'), controller.obtener);
  return router;
}

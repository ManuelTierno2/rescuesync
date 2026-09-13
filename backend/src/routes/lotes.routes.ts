import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createLotesController } from '../controllers/lotes.controller.js';
import { validate } from '../middlewares/validate.js';
import { crearLoteSchema, emergenciaLotesParamsSchema } from '../validators/lotes.schema.js';
import { requireDevRole } from './workflow.routes.js';

export function createLotesRouter(prisma: PrismaClient) {
  const router = Router({ mergeParams: true });
  const controller = createLotesController(prisma);
  router.get('/', validate(emergenciaLotesParamsSchema, 'params'), controller.listar);
  router.post('/', validate(emergenciaLotesParamsSchema, 'params'), validate(crearLoteSchema, 'body'), requireDevRole(prisma, 'COORDINADOR'), controller.crear);
  return router;
}

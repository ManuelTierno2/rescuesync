import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createEmergenciasController } from '../controllers/emergencias.controller.js';
import { validate } from '../middlewares/validate.js';
import { crearEmergenciaSchema, emergenciaIdSchema } from '../validators/emergencias.schema.js';
import type { BonitaService } from '../integrations/bonita/bonita.service.js';
import { createLotesRouter } from './lotes.routes.js';

export function createEmergenciasRouter(prisma: PrismaClient, bonita?: BonitaService) {
  const router = Router();
  const controller = createEmergenciasController(prisma, bonita);
  router.get('/', controller.listar);
  router.use('/:emergenciaId/lotes', createLotesRouter(prisma));
  router.post('/', validate(crearEmergenciaSchema, 'body'), controller.crear);
  router.get('/:id', validate(emergenciaIdSchema, 'params'), controller.obtener);
  return router;
}

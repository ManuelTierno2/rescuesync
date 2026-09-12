import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createEmergenciasController } from '../controllers/emergencias.controller.js';
import { validate } from '../middlewares/validate.js';
import { crearEmergenciaSchema, emergenciaIdSchema } from '../validators/emergencias.schema.js';

export function createEmergenciasRouter(prisma: PrismaClient) {
  const router = Router();
  const controller = createEmergenciasController(prisma);
  router.post('/', validate(crearEmergenciaSchema, 'body'), controller.crear);
  router.get('/:id', validate(emergenciaIdSchema, 'params'), controller.obtener);
  return router;
}

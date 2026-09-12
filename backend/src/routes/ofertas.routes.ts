import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createOfertasController } from '../controllers/ofertas.controller.js';
import { validate } from '../middlewares/validate.js';
import { crearOfertaSchema, loteOfertasParamsSchema } from '../validators/ofertas.schema.js';

export function createOfertasRouter(prisma: PrismaClient) {
  const router = Router({ mergeParams: true });
  const controller = createOfertasController(prisma);
  router.get('/', validate(loteOfertasParamsSchema, 'params'), controller.listar);
  router.post('/', validate(loteOfertasParamsSchema, 'params'), validate(crearOfertaSchema, 'body'), controller.crear);
  return router;
}

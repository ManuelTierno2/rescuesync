import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { validate } from '../middlewares/validate.js';
import { createAuthMiddleware } from '../middlewares/auth.js';
import {
  agregarMiembroSchema,
  consorcioIdParamsSchema,
  crearConsorcioSchema,
  type CrearConsorcioInput,
} from '../validators/consorcios.schema.js';
import { agregarMiembro, crearConsorcio, listarConsorcios } from '../services/consorcios.service.js';
import type { AuthConfig } from '../config/env.js';
import { readAuthConfig } from '../config/env.js';

export function createConsorciosRouter(prisma: PrismaClient, authConfig: AuthConfig = readAuthConfig()) {
  const router = Router();
  const { requireRole } = createAuthMiddleware(prisma, authConfig);

  router.get('/', requireRole('ONG'), async (req, res) => {
    res.json({ data: await listarConsorcios(prisma, req.user!.id) });
  });

  router.post('/', requireRole('ONG'), validate(crearConsorcioSchema, 'body'), async (req, res) => {
    const body = res.locals.body as CrearConsorcioInput;
    res.status(201).json({ data: await crearConsorcio(prisma, req.user!.id, body) });
  });

  router.post(
    '/:id/miembros',
    requireRole('ONG'),
    validate(consorcioIdParamsSchema, 'params'),
    validate(agregarMiembroSchema, 'body'),
    async (req, res) => {
      const { id } = res.locals.params as { id: string };
      const body = res.locals.body as { ong_usuario_id: string };
      res.status(201).json({ data: await agregarMiembro(prisma, id, req.user!.id, body.ong_usuario_id) });
    },
  );

  return router;
}

import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { validate } from '../middlewares/validate.js';
import { createAuthMiddleware } from '../middlewares/auth.js';
import {
  actualizarInventarioSchema,
  crearInventarioSchema,
  inventarioIdParamsSchema,
  type ActualizarInventarioInput,
  type CrearInventarioInput,
} from '../validators/inventario.schema.js';
import { actualizarInventario, crearInventario, listarInventario } from '../services/inventario.service.js';
import type { AuthConfig } from '../config/env.js';
import { readAuthConfig } from '../config/env.js';

export function createInventarioRouter(prisma: PrismaClient, authConfig: AuthConfig = readAuthConfig()) {
  const router = Router();
  const { requireRole } = createAuthMiddleware(prisma, authConfig);

  router.get('/', requireRole('ONG'), async (req, res) => {
    res.json({ data: await listarInventario(prisma, req.user!.id) });
  });

  router.post('/', requireRole('ONG'), validate(crearInventarioSchema, 'body'), async (req, res) => {
    const body = res.locals.body as CrearInventarioInput;
    res.status(201).json({ data: await crearInventario(prisma, req.user!.id, body) });
  });

  router.patch(
    '/:id',
    requireRole('ONG'),
    validate(inventarioIdParamsSchema, 'params'),
    validate(actualizarInventarioSchema, 'body'),
    async (req, res) => {
      const { id } = res.locals.params as { id: string };
      const body = res.locals.body as ActualizarInventarioInput;
      res.json({ data: await actualizarInventario(prisma, id, req.user!.id, body) });
    },
  );

  return router;
}

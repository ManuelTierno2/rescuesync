import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { validate } from '../middlewares/validate.js';
import { createAuthMiddleware } from '../middlewares/auth.js';
import { crearOrganizacionSchema } from '../validators/organizaciones.schema.js';
import { crearOrganizacion, listarOrganizaciones } from '../services/organizaciones.service.js';
import type { AuthConfig } from '../config/env.js';
import { readAuthConfig } from '../config/env.js';
import type { CrearOrganizacionInput } from '../validators/organizaciones.schema.js';

export function createOrganizacionesRouter(prisma: PrismaClient, authConfig: AuthConfig = readAuthConfig()) {
  const router = Router();
  const { requireAuth, requireRole } = createAuthMiddleware(prisma, authConfig);

  router.get('/', requireAuth, async (_req, res) => {
    res.json({ data: await listarOrganizaciones(prisma) });
  });

  router.post('/', requireRole('COORDINADOR', 'AUDITOR'), validate(crearOrganizacionSchema, 'body'), async (_req, res) => {
    const body = res.locals.body as CrearOrganizacionInput;
    res.status(201).json({ data: await crearOrganizacion(prisma, body) });
  });

  return router;
}

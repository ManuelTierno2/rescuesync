import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { BonitaService } from '../integrations/bonita/bonita.service.js';
import { createAuthMiddleware } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { readAuthConfig, type AuthConfig } from '../config/env.js';
import { calcularIndicadores, type FiltrosIndicadores } from '../services/indicadores.service.js';

export const indicadoresQuerySchema = z.object({
  desde: z.iso.date().optional(),
  hasta: z.iso.date().optional(),
  gravedad: z.enum(['BAJA', 'MEDIA', 'ALTA', 'CRITICA']).optional(),
}).refine(v => !v.desde || !v.hasta || v.desde <= v.hasta, {
  message: 'La fecha desde debe ser anterior o igual a hasta.', path: ['desde'],
});

/** Tablero directivo: solo el rol AUDITOR (Auditor / Directivo). */
export function createIndicadoresRouter(prisma: PrismaClient, bonita: BonitaService, authConfig: AuthConfig = readAuthConfig()) {
  const router = Router();
  const { requireRole } = createAuthMiddleware(prisma, authConfig);
  router.get('/', requireRole('AUDITOR'), validate(indicadoresQuerySchema, 'query'), async (_req, res) => {
    res.json({ data: await calcularIndicadores(prisma, bonita, res.locals.query as FiltrosIndicadores) });
  });
  return router;
}

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
import { createCatalogoSn, type CatalogoSnService } from '../services/catalogo-sn.service.js';
import type { SnClient } from '../integrations/sistema-nacional/sn.client.js';
import { AppError } from '../errors/app-error.js';

export function createInventarioRouter(
  prisma: PrismaClient,
  authConfig: AuthConfig = readAuthConfig(),
  catalogo: CatalogoSnService = createCatalogoSn(),
  sn?: SnClient,
) {
  const router = Router();
  const { requireRole } = createAuthMiddleware(prisma, authConfig);

  router.get('/', requireRole('ONG'), async (req, res) => {
    res.json({ data: await listarInventario(prisma, req.user!.id) });
  });

  /** Códigos de recurso que acepta el Sistema Nacional (la ONG elige cualquiera de ellos). */
  router.get('/codigos-sn', requireRole('ONG'), async (_req, res) => {
    const { items, origen } = await catalogo.listar();
    res.json({ data: items, origen });
  });

  /**
   * Lo que el Sistema Nacional sabe de la ONG logueada (externalId = id del usuario ONG local) y la
   * disponibilidad global. La ONG se registra en el SN al validarse su primera oferta: antes, `ong` es null.
   */
  router.get('/nacional', requireRole('ONG'), async (req, res) => {
    if (!sn) {
      res.json({ data: { conectado: false, ong: null, disponibilidad: [] } });
      return;
    }
    try {
      const [ong, disponibilidad] = await Promise.all([sn.getOng(req.user!.id), sn.getDisponibilidad()]);
      res.json({ data: { conectado: true, ong, disponibilidad } });
    } catch {
      throw new AppError(502, 'SN_NO_DISPONIBLE', 'No se pudo consultar el Sistema Nacional. Intente nuevamente en un minuto.');
    }
  });

  router.post('/', requireRole('ONG'), validate(crearInventarioSchema, 'body'), async (req, res) => {
    const body = res.locals.body as CrearInventarioInput;
    res.status(201).json({ data: await crearInventario(prisma, req.user!.id, body, catalogo) });
  });

  router.patch(
    '/:id',
    requireRole('ONG'),
    validate(inventarioIdParamsSchema, 'params'),
    validate(actualizarInventarioSchema, 'body'),
    async (req, res) => {
      const { id } = res.locals.params as { id: string };
      const body = res.locals.body as ActualizarInventarioInput;
      res.json({ data: await actualizarInventario(prisma, id, req.user!.id, body, catalogo) });
    },
  );

  return router;
}

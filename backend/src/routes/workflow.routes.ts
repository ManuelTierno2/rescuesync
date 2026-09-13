import { Router, type Request, type RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { BonitaService } from '../integrations/bonita/bonita.service.js';
import { isBonitaId } from '../integrations/bonita/bonita.client.js';
import { AppError } from '../errors/app-error.js';
import { createWorkflowService, taskNames, type Action, type ActionInput, type WorkflowOptions } from '../services/workflow.service.js';
import { calculateCoverage } from '../services/workflow-data.js';

const uuid = z.uuid();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', 'Revise los datos enviados.', result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
  return result.data;
}
export function devActor(req: Request) { return parse(uuid, req.get('X-Dev-User-Id')); }
export function requireDevRole(prisma: PrismaClient, role: string): RequestHandler {
  return async (req, _res, next) => {
    const actor = await prisma.usuario.findUnique({ where: { id: devActor(req) } });
    if (!actor || actor.rol !== role) throw new AppError(403, 'FORBIDDEN_ROLE', 'El usuario no puede realizar esta acción.');
    next();
  };
}
export function createWorkflowRouter(prisma: PrismaClient, bonita: BonitaService, options: WorkflowOptions) {
  const router = Router({ mergeParams: true });
  const service = createWorkflowService(prisma, bonita, options);
  router.use((req, res, next) => { res.locals.emergenciaId = parse(uuid, req.params.id); next(); });
  router.get('/workflow', async (_req, res) => { res.json(await service.inspect(res.locals.emergenciaId)); });
  router.get('/cobertura', async (_req, res) => { res.json({ data: await calculateCoverage(prisma, res.locals.emergenciaId) }); });
  router.get('/monitoreo', async (_req, res) => { res.json(await service.monitoring(res.locals.emergenciaId)); });
  for (const action of Object.keys(taskNames) as Action[]) {
    const schema = z.object({ accionId: uuid,
      ...(action === 'decidir' ? { cursoAccion: z.enum(['REABRIR', 'REFORMULAR', 'PARCIAL']) } : {}),
      ...(action === 'adjudicar' ? { ofertaIds: z.array(uuid).min(1).max(1000) } : {}),
    }).strict();
    router.post('/acciones/' + action, async (req, res) => {
      res.json(await service.perform(res.locals.emergenciaId, devActor(req), action, parse(schema, req.body) as ActionInput));
    });
  }
  router.post('/acciones/nueva-ronda', async (req, res) => {
    parse(z.object({}).strict(), req.body);
    res.json(await service.newRound(res.locals.emergenciaId, devActor(req)));
  });
  router.post('/acciones/:accionId/reconciliar', async (req, res) => {
    parse(z.object({}).strict(), req.body);
    res.json(await service.reconcile(res.locals.emergenciaId, devActor(req), parse(uuid, req.params.accionId)));
  });
  return router;
}
export function createBonitaCallbacks(prisma: PrismaClient, bonita: BonitaService, options: WorkflowOptions) {
  const router = Router();
  const service = createWorkflowService(prisma, bonita, options);
  router.use((req, _res, next) => {
    const supplied = Buffer.from(req.get('Authorization') ?? '');
    const expected = Buffer.from('Bearer ' + options.callbackSecret);
    if (!options.callbackSecret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      throw new AppError(401, 'CALLBACK_UNAUTHORIZED', 'Credenciales de conector inválidas.');
    next();
  });
  for (const kind of ['abrir', 'evaluar'] as const) router.post('/emergencias/:id/convocatoria/' + kind, async (req, res) => {
    const input = parse(z.object({ caseId: z.string().refine(isBonitaId), actividadId: z.string().refine(isBonitaId),
      ...(kind === 'abrir' ? { duracionMs: z.number().int().min(1).max(604800000) } : {}),
    }).strict(), req.body);
    res.json(await service.callback(parse(uuid, req.params.id), kind, input as { caseId: string; actividadId: string; duracionMs?: number }));
  });
  return router;
}

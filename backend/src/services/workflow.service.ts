import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Prisma, PrismaClient, AccionWorkflow } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import { BonitaError, type HumanTask } from '../integrations/bonita/bonita.client.js';
import { createBonitaService, type BonitaService } from '../integrations/bonita/bonita.service.js';
import { currentRound, lockEmergency, roundCoverage } from './workflow-data.js';

export interface WorkflowOptions {
  compatibleProcessIds: string[]; validationMode: 'PENDIENTE' | 'DESARROLLO'; callbackSecret: string;
}
export const defaultWorkflowOptions: WorkflowOptions = { compatibleProcessIds: [], validationMode: 'PENDIENTE', callbackSecret: '' };
export const taskNames = {
  registrar: 'Registrar emergencia', publicar: 'Generar y publicar lotes',
  decidir: 'Evaluar curso alternativo',
  'ver-ofertas': 'ver-ofertas', adjudicar: 'adjudicar', leer: 'leer',
  'finalizar-actividad': 'Marcar actividad finalizada', 'finalizar-monitoreo': 'Monitorear despliegue', cerrar: 'cerrar',
} as const;
export type Action = keyof typeof taskNames;
/** Acciones solo PostgreSQL: no buscan ni completan tareas humanas Bonita. */
export const localOnlyActions = new Set<Action>(['ver-ofertas', 'adjudicar', 'leer', 'cerrar']);
const roles: Record<Action | 'nueva-ronda', string> = {
  decidir: 'COORDINADOR',
  registrar: 'MUNICIPIO', publicar: 'COORDINADOR', 'ver-ofertas': 'MUNICIPIO',
  adjudicar: 'MUNICIPIO', leer: 'ONG', 'finalizar-actividad': 'ONG', 'finalizar-monitoreo': 'COORDINADOR', cerrar: 'COORDINADOR', 'nueva-ronda': 'COORDINADOR',
};
export const courseDecisions = ['CONTINUAR_PARCIAL', 'REABRIR', 'REFORMULAR'] as const;
export interface ActionInput { accionId: string; ofertaIds?: string[]; decisionCurso?: typeof courseDecisions[number] }
interface ActionResult { data: AccionWorkflow; warnings?: { code: string; message: string }[] }
function conflict(code: string, message: string): never { throw new AppError(409, code, message); }
export function integrationWarning(error: unknown) {
  return { code: error instanceof BonitaError || error instanceof AppError ? error.code : 'BONITA_RESULT_UNKNOWN',
    message: error instanceof BonitaError || error instanceof AppError ? error.message : 'Los datos se guardaron; no se pudo confirmar la sincronización. Consulte Estado Bonita.' };
}
export function createWorkflowService(prisma: PrismaClient, bonita: BonitaService = createBonitaService(), options: WorkflowOptions = defaultWorkflowOptions) {
  const client = bonita.client;
  async function emergency(id: string) {
    const value = await prisma.emergencia.findUnique({ where: { id } });
    if (!value) throw new AppError(404, 'EMERGENCIA_NOT_FOUND', 'La emergencia no existe.');
    return value;
  }
  async function authorize(emergenciaId: string, actorId: string, action: Action | 'nueva-ronda') {
    const [e, actor] = await Promise.all([emergency(emergenciaId), prisma.usuario.findUnique({ where: { id: actorId } })]);
    if (!actor || actor.rol !== roles[action]) throw new AppError(403, 'FORBIDDEN_ROLE', 'El usuario no puede realizar esta acción.');
    if (actor.rol === 'MUNICIPIO' && e.creada_por_id !== actorId) throw new AppError(403, 'FORBIDDEN_OWNER', 'La emergencia pertenece a otro municipio.');
    return e;
  }
  async function requireCompatible(caseId: string) {
    if (!client) return;
    const state = await client.getCaseState(caseId);
    if (state.state !== 'OPEN') conflict('WORKFLOW_NOT_OPEN', 'El caso no está abierto o no se pudo confirmar su estado.');
    if (!state.processId || !options.compatibleProcessIds.includes(state.processId))
      conflict('BPMN_INCOMPATIBLE', 'La definición necesita los cambios manuales de Studio y su verificación antes de habilitar este tramo.');
    if (!options.callbackSecret) conflict('BPMN_CALLBACK_MISSING', 'Falta configurar el secreto de los conectores de convocatoria.');
  }
  async function checkContract(taskId: string, values: Record<string, unknown>) {
    const contract = await client!.getTaskContract(taskId) as { inputs?: { name: string; type: string; multiple?: boolean }[] };
    if (!contract || !Array.isArray(contract.inputs)) throw new BonitaError('BPMN_CONTRACT_INCOMPATIBLE', 'No se pudo verificar el contrato de la tarea.');
    const inputs = contract.inputs;
    if (inputs.length !== Object.keys(values).length || inputs.some(i => !(i.name in values)))
      throw new BonitaError('BPMN_CONTRACT_INCOMPATIBLE', 'El contrato desplegado no coincide con el contrato requerido. Revisar la guía de Studio.');
    for (const input of inputs) {
      const v = values[input.name];
      if (input.type !== 'TEXT' || (input.multiple ? !Array.isArray(v) || !v.every(x => typeof x === 'string') : typeof v !== 'string'))
        throw new BonitaError('BPMN_CONTRACT_INCOMPATIBLE', 'El tipo del contrato desplegado es incompatible.');
    }
  }
  async function selectionPermitted(roundId: string, emergenciaId: string, db: Prisma.TransactionClient = prisma) {
    if (!client) return true;
    const window = await db.ventanaConvocatoria.findFirst({ where: { ronda_id: roundId }, orderBy: { abierta_at: 'desc' } });
    if (!window?.cerrada_at || !window.cobertura) return false;
    const coverage = window.cobertura as { lotesCubiertos?: boolean };
    if (coverage.lotesCubiertos === true) return true;
    return !!await db.accionWorkflow.findFirst({ where: {
      emergencia_id: emergenciaId, accion: 'decidir', estado: 'CONFIRMADO',
      created_at: { gte: window.cerrada_at }, contrato: { path: ['decisionCurso'], equals: 'CONTINUAR_PARCIAL' },
    } });
  }
  async function finish(action: AccionWorkflow): Promise<ActionResult> {
    if (!client || !action.task_id || !action.task_name) return { data: action };
    if (action.estado === 'CONFIRMADO') return { data: action };
    if (action.estado !== 'PENDIENTE' && action.estado !== 'RECHAZADO') return reconcile(action.emergencia_id, action.actor_id, action.id);
    // Durable claim prevents two callers from issuing execution for the same task.
    const claimed = await prisma.accionWorkflow.updateMany({ where: { id: action.id, estado: { in: ['PENDIENTE', 'RECHAZADO'] } }, data: { estado: 'ENVIANDO' } });
    if (!claimed.count) return { data: action, warnings: [{ code: 'BONITA_PENDING', message: 'La sincronización ya está en curso.' }] };
    try {
      const e = await emergency(action.emergencia_id);
      await client.executeHumanTask(action.task_id, action.contrato as Record<string, unknown>, {
        caseId: e.bonita_instance_id!.toString(), name: action.task_name, recipient: action.destinatario_id ?? undefined,
      });
      const updated = await prisma.accionWorkflow.update({ where: { id: action.id }, data: { estado: 'CONFIRMADO', error_code: null } });
      return { data: updated };
    } catch (error) {
      const warning = integrationWarning(error);
      // HTTP rejections and pre-execution checks are safe to retry on this exact task only.
      const rejected = /^(BONITA_HTTP_(400|401|403|404|409)|BONITA_TASK_(MISMATCH|ASSIGNED)|BONITA_AUTH_FAILED)$/.test(warning.code);
      let updated = action;
      try { updated = await prisma.accionWorkflow.update({ where: { id: action.id }, data: { estado: rejected ? 'RECHAZADO' : 'DESCONOCIDO', error_code: warning.code } }); } catch { /* Keep durable ENVIANDO if DB is down. */ }
      console.warn(JSON.stringify({ code: warning.code, emergencia_id: action.emergencia_id, task_id: action.task_id }));
      return { data: updated, warnings: [warning] };
    }
  }
  async function reconcile(emergenciaId: string, actorId: string, actionId: string): Promise<ActionResult> {
    const action = await prisma.accionWorkflow.findUnique({ where: { id: actionId } });
    if (!action || action.emergencia_id !== emergenciaId) throw new AppError(404, 'ACTION_NOT_FOUND', 'La acción no existe.');
    if (action.actor_id !== actorId) throw new AppError(403, 'FORBIDDEN_OWNER', 'La acción pertenece a otro usuario.');
    if (!client || !action.task_id || action.estado === 'CONFIRMADO') return { data: action };
    const e = await emergency(emergenciaId);
    try {
      if (await client.isTaskCompleted(e.bonita_instance_id!.toString(), action.task_id)) {
        return { data: await prisma.accionWorkflow.update({ where: { id: actionId }, data: { estado: 'CONFIRMADO', error_code: null } }) };
      }
      // A ready task after a timeout is not proof that the first request won't still execute.
      if (action.estado === 'RECHAZADO' || action.estado === 'PENDIENTE') return finish(action);
      return { data: action, warnings: [{ code: 'BONITA_RESULT_UNKNOWN', message: 'Todavía no hay confirmación archivada. No se reenvía una ejecución de resultado desconocido.' }] };
    } catch (error) { return { data: action, warnings: [integrationWarning(error)] }; }
  }
  async function perform(emergenciaId: string, actorId: string, action: Action, input: ActionInput) {
    const e = await authorize(emergenciaId, actorId, action);
    const solicitud = { ofertaIds: [...(input.ofertaIds ?? [])].sort(), ...(action === 'decidir' ? { decisionCurso: input.decisionCurso } : {}) };
    const previous = await prisma.accionWorkflow.findUnique({ where: { id: input.accionId } });
    if (previous) {
      const stored = previous.solicitud as { ofertaIds: string[]; decisionCurso?: string };
      if (previous.emergencia_id !== emergenciaId || previous.actor_id !== actorId || previous.accion !== action
        || stored.decisionCurso !== solicitud.decisionCurso
        || JSON.stringify(stored.ofertaIds ?? []) !== JSON.stringify(solicitud.ofertaIds)) conflict('ACTION_ID_REUSED', 'El identificador ya pertenece a otra solicitud.');
      return reconcile(emergenciaId, actorId, previous.id);
    }
    if (e.cerrada_at) conflict('EMERGENCIA_CERRADA', 'El operativo ya está cerrado.');
    let found: HumanTask | null = null;
    const recipient = ['leer', 'finalizar-actividad'].includes(action) ? actorId : undefined;
    const localOnly = localOnlyActions.has(action);
    if (action === 'decidir' && (!client || !input.decisionCurso || !courseDecisions.includes(input.decisionCurso)))
      conflict('DECISION_UNAVAILABLE', 'La decisión requiere una tarea de evaluación en Bonita y una opción válida.');
    if (client) {
      if (!e.bonita_instance_id) conflict('BONITA_UNLINKED', 'La emergencia no tiene un caso vinculado. No se iniciará otro caso.');
      // La selección se guarda localmente, pero debe respetar la reformulación del motor.
      if (action === 'ver-ofertas' || action === 'adjudicar') {
        await requireCompatible(e.bonita_instance_id.toString());
        if (await client.findReadyHumanTask(e.bonita_instance_id.toString(), taskNames.publicar))
          conflict('ROUND_REFORMULATION_REQUIRED', 'Bonita está en Generar y publicar lotes. El coordinador debe preparar y publicar la nueva ronda antes de adjudicar.');
        const tasks = await client.listReadyHumanTasks(e.bonita_instance_id.toString());
        if (tasks.some(t => [taskNames.decidir, 'Cargar o editar ofertas'].includes(t.name)))
          conflict('SELECTION_NOT_READY', 'La convocatoria o la decisión del coordinador todavía está pendiente.');
      }
      // cerrar puede ocurrir tras COMPLETED; las acciones locales no ejecutan tareas Bonita.
      if (!localOnly) {
        if (action !== 'registrar') await requireCompatible(e.bonita_instance_id.toString());
        found = await client.findReadyHumanTask(e.bonita_instance_id.toString(), taskNames[action],
          action === 'finalizar-actividad' ? recipient : undefined);
        if (!found) conflict('BONITA_TASK_NOT_FOUND', 'La tarea todavía no está disponible. Actualice Estado Bonita.');
      }
    }
    const contrato: Record<string, unknown> = action === 'registrar' ? { emergenciaId }
      : action === 'decidir' ? { decisionCurso: input.decisionCurso } : {};
    if (found && action === 'finalizar-monitoreo') {
      const contract = await client!.getTaskContract(found.id) as { inputs?: { name: string }[] };
      if (contract?.inputs?.some(i => i.name === 'ongDestinatariosInput')) {
        const round = await prisma.ronda.findFirst({ where: { emergencia_id: emergenciaId }, orderBy: { numero: 'desc' },
          include: { participaciones: { select: { ong_usuario_id: true } } } });
        if (!round?.seleccionada_at) conflict('SELECTION_PENDING', 'Falta confirmar la adjudicación.');
        const recipients = [...new Set(round.participaciones.map(p => p.ong_usuario_id))].sort();
        if (!recipients.length) conflict('NO_AWARD', 'No hay ONG adjudicadas para crear las tareas finales.');
        contrato.ongDestinatariosInput = recipients;
      }
    }
    if (found) await checkContract(found.id, contrato);
    const saved = await prisma.$transaction(async tx => {
      const locked = await lockEmergency(tx, emergenciaId);
      if (locked.cerrada_at) conflict('EMERGENCIA_CERRADA', 'El operativo ya está cerrado.');
      const existing = await tx.accionWorkflow.findUnique({ where: { id: input.accionId } });
      if (existing) conflict('ACTION_IN_PROGRESS', 'La solicitud ya fue registrada. Consulte su estado.');
      if (found && await tx.accionWorkflow.findUnique({ where: { task_id: found.id } })) conflict('TASK_ALREADY_SUBMITTED', 'Esta tarea ya tiene una acción registrada. Consulte o reconcilie esa acción.');
      const round = await currentRound(tx, emergenciaId);
      const now = new Date();
      if (action === 'decidir') {
        const window = await tx.ventanaConvocatoria.findFirst({ where: { ronda_id: round.id }, orderBy: { abierta_at: 'desc' } });
        if (!round.publicada_at || round.seleccionada_at || !window?.cerrada_at || !window.cobertura)
          conflict('DECISION_NOT_READY', 'Primero debe finalizar la evaluación de la convocatoria vigente.');
        const coverage = window.cobertura as { lotesCubiertos?: boolean; lotes?: { cantidadOfrecida: number }[] };
        if (coverage.lotesCubiertos !== false) conflict('DECISION_NOT_REQUIRED', 'La ronda ya tiene cobertura completa.');
        if (input.decisionCurso === 'CONTINUAR_PARCIAL' && !coverage.lotes?.some(l => l.cantidadOfrecida > 0))
          conflict('NO_OFFERS', 'No hay ofertas para continuar con cobertura parcial.');
      }
      if (action === 'publicar') {
        if (round.publicada_at) conflict('ROUND_ALREADY_PUBLISHED', 'La ronda ya fue publicada. Cree la nueva ronda cuando Bonita habilite reformulación.');
        if (!await tx.lote.count({ where: { ronda_id: round.id } })) conflict('NO_LOTES', 'Debe existir al menos un lote.');
        await tx.ronda.update({ where: { id: round.id }, data: { publicada_at: now, tarea_lotes_id: found?.id } });
        if (!client) await tx.ventanaConvocatoria.create({ data: { ronda_id: round.id, actividad_id: 'local-' + input.accionId,
          vence_at: new Date('9999-01-01T00:00:00Z') } });
      }
      if (action === 'ver-ofertas' || action === 'adjudicar') {
        if (options.validationMode !== 'DESARROLLO') conflict('VALIDACION_PENDIENTE', 'La validación externa está pendiente. El modo de desarrollo debe habilitarse explícitamente.');
        if (!round.publicada_at) conflict('ROUND_NOT_PUBLISHED', 'Primero debe publicarse la convocatoria.');
        if (!await selectionPermitted(round.id, emergenciaId, tx))
          conflict('SELECTION_NOT_READY', 'Falta evaluar la cobertura o confirmar la decisión de continuar parcialmente.');
        if (action === 'ver-ofertas') {
          if (round.ofertas_vistas_at) conflict('ALREADY_VIEWED', 'Ya se confirmó la visualización.');
          await tx.ronda.update({ where: { id: round.id }, data: { ofertas_vistas_at: now } });
        } else {
          if (round.seleccionada_at) conflict('ALREADY_SELECTED', 'La adjudicación ya está confirmada.');
          if (!round.ofertas_vistas_at) conflict('OFFERS_NOT_VIEWED', 'Primero continúe desde la visualización de ofertas.');
          const ids = input.ofertaIds ?? [];
          if (!ids.length || new Set(ids).size !== ids.length) throw new AppError(422, 'INVALID_SELECTION', 'Seleccione una o más ofertas sin repetir.');
          const offers = await tx.oferta.findMany({ where: { id: { in: ids }, activa: true, lote: { ronda_id: round.id } }, include: { lote: true } });
          if (offers.length !== ids.length) throw new AppError(422, 'INVALID_SELECTION', 'Las ofertas deben estar activas y pertenecer a la ronda vigente.');
          const totals = new Map<string, number>();
          for (const offer of offers) {
            const sum = (totals.get(offer.lote_id) ?? 0) + offer.cantidad_ofrecida;
            if (sum > offer.lote.cantidad_requerida) throw new AppError(422, 'SELECTION_EXCEEDS_LOT', 'La selección supera la cantidad requerida de un lote.');
            totals.set(offer.lote_id, sum);
          }
          await tx.adjudicacion.createMany({ data: ids.map(oferta_id => ({ oferta_id, municipio_id: actorId })) });
          await tx.participacionOng.createMany({ data: [...new Set(offers.map(o => o.ong_usuario_id))].map(ong_usuario_id => ({ ronda_id: round.id, ong_usuario_id })) });
          await tx.ronda.update({ where: { id: round.id }, data: { seleccionada_at: now } });
          if (!client) await tx.ventanaConvocatoria.updateMany({ where: { ronda_id: round.id, cerrada_at: null }, data: { cerrada_at: now } });
        }
      }
      if (recipient) {
        const p = await tx.participacionOng.findUnique({ where: { ronda_id_ong_usuario_id: { ronda_id: round.id, ong_usuario_id: actorId } } });
        if (!p) throw new AppError(403, 'NO_AWARD', 'La ONG no tiene ofertas adjudicadas en esta ronda.');
        if (action === 'leer' ? p.lectura_at : p.finalizada_at) conflict('ALREADY_CONFIRMED', 'La confirmación ya fue registrada.');
        if (action === 'finalizar-actividad' && !p.lectura_at) conflict('READING_PENDING', 'Primero confirme la lectura.');
        await tx.participacionOng.update({ where: { id: p.id }, data: action === 'leer' ? { lectura_at: now } : { finalizada_at: now } });
      }
      if (action === 'finalizar-monitoreo') {
        if (!round.seleccionada_at) conflict('SELECTION_PENDING', 'Falta confirmar la adjudicación.');
        if (round.monitoreo_finalizado_at) conflict('ALREADY_CONFIRMED', 'El monitoreo ya fue finalizado.');
        await tx.ronda.update({ where: { id: round.id }, data: { monitoreo_finalizado_at: now } });
      }
      if (action === 'cerrar') {
        if (!round.monitoreo_finalizado_at || !round.seleccionada_at || await tx.participacionOng.count({ where: { ronda_id: round.id, finalizada_at: null } }))
          conflict('CLOSURE_PENDING', 'Deben finalizar el monitoreo y todas las actividades ONG.');
        await tx.emergencia.update({ where: { id: emergenciaId }, data: { cerrada_at: now } });
      }
      // Local-only actions confirm immediately (task_id null). Bonita sync only when a ready task was claimed.
      return tx.accionWorkflow.create({ data: { id: input.accionId, emergencia_id: emergenciaId, actor_id: actorId, accion: action,
        task_id: found?.id, task_name: found?.name, destinatario_id: recipient, contrato: contrato as Prisma.InputJsonObject,
        solicitud, estado: found ? 'PENDIENTE' : 'CONFIRMADO' } });
    });
    return finish(saved);
  }
  async function newRound(emergenciaId: string, actorId: string) {
    const e = await authorize(emergenciaId, actorId, 'nueva-ronda');
    if (!client || !e.bonita_instance_id) conflict('BONITA_DISABLED', 'La reformulación requiere una tarea habilitada por Bonita.');
    await requireCompatible(e.bonita_instance_id.toString());
    const task = await client.findReadyHumanTask(e.bonita_instance_id.toString(), taskNames.publicar);
    if (!task) conflict('BONITA_TASK_NOT_FOUND', 'Bonita todavía no habilitó la reformulación.');
    return prisma.$transaction(async tx => {
      if ((await lockEmergency(tx, emergenciaId)).cerrada_at) conflict('EMERGENCIA_CERRADA', 'El operativo está cerrado.');
      const round = await currentRound(tx, emergenciaId);
      if (!round.publicada_at) return { data: round };
      if (round.tarea_lotes_id === task.id) conflict('ROUND_ALREADY_PUBLISHED', 'La publicación anterior todavía no avanzó.');
      return { data: await tx.ronda.create({ data: { emergencia_id: emergenciaId, numero: round.numero + 1, tarea_lotes_id: task.id } }) };
    });
  }
  async function inspect(emergenciaId: string) {
    const e = await emergency(emergenciaId);
    const round = await prisma.ronda.findFirst({ where: { emergencia_id: emergenciaId }, orderBy: { numero: 'desc' } });
    const actions = await prisma.accionWorkflow.findMany({ where: { emergencia_id: emergenciaId }, orderBy: { created_at: 'asc' } });
    const windows = round ? await prisma.ventanaConvocatoria.findMany({ where: { ronda_id: round.id }, orderBy: { abierta_at: 'desc' } }) : [];
    const data = { enabled: !!client, caseId: e.bonita_instance_id?.toString() ?? null,
      state: !client ? 'DISABLED' : !e.bonita_instance_id ? 'UNLINKED' : 'UNKNOWN', readyTasks: [] as (HumanTask & { ongUsuarioId?: string })[],
      compatible: !client, availableActions: [] as string[], round, windows, actions, localClosed: !!e.cerrada_at, validationMode: options.validationMode };
    const warnings: { code: string; message: string }[] = [];
    if (client && e.bonita_instance_id) {
      try {
        const state = await client.getCaseState(e.bonita_instance_id.toString()); data.state = state.state;
        data.compatible = !!state.processId && options.compatibleProcessIds.includes(state.processId) && !!options.callbackSecret;
        if (state.state === 'OPEN') {
          data.readyTasks = await client.listReadyHumanTasks(e.bonita_instance_id.toString());
          for (const task of data.readyTasks) if (task.name === taskNames['finalizar-actividad']) {
            try { task.ongUsuarioId = String(await client.getActivityVariable(task.id, 'ongUsuarioId')); }
            catch (error) { warnings.push(integrationWarning(error)); }
          }
          data.availableActions = Object.entries(taskNames)
            .filter(([key, name]) => !localOnlyActions.has(key as Action) && (data.compatible || key === 'registrar')
              && data.readyTasks.some(t => t.name === name)).map(([key]) => key);
          if (data.compatible) {
            data.availableActions.push('leer', 'cerrar');
            if (options.validationMode === 'DESARROLLO' && round && await selectionPermitted(round.id, emergenciaId)
              && !data.readyTasks.some(t => [taskNames.publicar, taskNames.decidir, 'Cargar o editar ofertas'].includes(t.name)))
              data.availableActions.push('ver-ofertas', 'adjudicar');
          }
          if (data.compatible && data.readyTasks.some(t => t.name === taskNames.decidir)) data.availableActions = ['decidir'];
          if (data.compatible && round?.publicada_at && data.readyTasks.some(t => t.name === taskNames.publicar && t.id !== round.tarea_lotes_id)) {
            data.availableActions = ['nueva-ronda'];
          }
          if (!data.compatible) warnings.push({ code: 'BPMN_INCOMPATIBLE', message: 'Los tramos posteriores al registro requieren verificar y desplegar los cambios manuales de Studio.' });
        }
      } catch (error) { warnings.push(integrationWarning(error)); }
    } else if (!client && !e.cerrada_at) data.availableActions = ['publicar', 'ver-ofertas', 'adjudicar', 'leer', 'finalizar-actividad', 'finalizar-monitoreo', 'cerrar'];
    return { data, ...(warnings.length ? { warnings } : {}) };
  }
  async function monitoring(emergenciaId: string) {
    const e = await emergency(emergenciaId);
    const rondas = await prisma.ronda.findMany({ where: { emergencia_id: emergenciaId }, orderBy: { numero: 'desc' },
      include: { lotes: { include: { ofertas: { include: { adjudicacion: true, ong_usuario: { select: { id: true, nombre: true, organizacion: true } } } } } },
        participaciones: { include: { ong_usuario: { select: { id: true, nombre: true, organizacion: true } } } } } });
    return { data: { emergencia: { ...e, bonita_instance_id: e.bonita_instance_id?.toString() ?? null }, rondas, validationMode: options.validationMode } };
  }
  async function callback(emergenciaId: string, kind: 'abrir' | 'evaluar', input: { caseId: string; actividadId: string; duracionMs?: number }) {
    if (!client) conflict('BONITA_DISABLED', 'Bonita está deshabilitado.');
    const e = await emergency(emergenciaId);
    if (e.bonita_instance_id?.toString() !== input.caseId) throw new AppError(403, 'BONITA_CASE_MISMATCH', 'El caso no corresponde a la emergencia.');
    const recorded = await prisma.ventanaConvocatoria.findUnique({ where: { actividad_id: input.actividadId }, include: { ronda: true } });
    if (recorded && recorded.ronda.emergencia_id !== emergenciaId) conflict('WINDOW_MISMATCH', 'La ventana pertenece a otra emergencia.');
    if (recorded && kind === 'abrir') { const { ronda: _round, ...window } = recorded; return { data: window }; }
    if (recorded?.cobertura && kind === 'evaluar') return { data: recorded.cobertura };
    await requireCompatible(input.caseId);
    // The boundary timer starts before the opening callback reaches the API.
    // Wait out a small offset without shortening the window or holding a DB lock.
    if (kind === 'evaluar' && recorded) {
      const remaining = recorded.vence_at.getTime() - Date.now();
      if (remaining > 0 && remaining <= 2000) {
        while (recorded.vence_at.getTime() > Date.now())
          await delay(recorded.vence_at.getTime() - Date.now());
      }
    }
    return prisma.$transaction(async tx => {
      const locked = await lockEmergency(tx, emergenciaId);
      if (locked.cerrada_at) conflict('EMERGENCIA_CERRADA', 'El operativo está cerrado.');
      const round = await currentRound(tx, emergenciaId);
      const previous = await tx.ventanaConvocatoria.findUnique({ where: { actividad_id: input.actividadId } });
      if (previous && previous.ronda_id !== round.id) conflict('WINDOW_MISMATCH', 'La ventana pertenece a otra ronda.');
      if (kind === 'abrir') {
        if (previous) return { data: previous };
        if (!round.publicada_at || round.seleccionada_at) conflict('INVALID_WINDOW', 'La ronda no admite convocatoria.');
        if (await tx.ventanaConvocatoria.count({ where: { ronda_id: round.id, cerrada_at: null } })) conflict('WINDOW_ALREADY_OPEN', 'La ronda ya tiene una ventana abierta.');
        await tx.ronda.update({ where: { id: round.id }, data: { ofertas_vistas_at: null } });
        const duration = input.duracionMs ?? 3600000;
        return { data: await tx.ventanaConvocatoria.create({ data: { ronda_id: round.id, actividad_id: input.actividadId,
          vence_at: new Date(Date.now() + duration) } }) };
      }
      if (!previous) conflict('WINDOW_NOT_FOUND', 'Falta registrar la apertura de convocatoria.');
      if (previous.cobertura) return { data: previous.cobertura };
      if (previous.vence_at.getTime() > Date.now()) conflict('WINDOW_NOT_EXPIRED', 'La ventana todavía no venció.');
      const coverage = await roundCoverage(tx, round.id);
      await tx.ventanaConvocatoria.update({ where: { id: previous.id }, data: { cerrada_at: new Date(), cobertura: coverage } });
      return { data: coverage };
    });
  }
  return { perform, reconcile, newRound, inspect, monitoring, callback,
    register: (emergenciaId: string, actorId: string) => perform(emergenciaId, actorId, 'registrar', { accionId: randomUUID() }) };
}

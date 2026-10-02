import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, describe, it } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPrismaClient } from '../src/database/prisma.js';
import { createBonitaService } from '../src/integrations/bonita/bonita.service.js';
import { calculateCoverage } from '../src/services/workflow-data.js';
import { bonitaServer, PROCESS_ID, type StubOptions } from './helpers/bonita-server.js';
import { testDatabaseUrl } from './helpers/test-database.js';
import { seedUsuarios, MUNICIPIO_DEMO_ID as M, COORDINADOR_DEMO_ID as C, ONG_A_DEMO_ID as A, ONG_B_DEMO_ID as B, AUDITOR_DEMO_ID as U } from '../prisma/seed.js';

const dbUrl = testDatabaseUrl();
const prisma = createPrismaClient(dbUrl);
const secret = 'workflow-test-connector-secret-000000000';
const owned: string[] = [];
before(async () => {
  await promisify(execFile)(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: dbUrl }, windowsHide: true,
  });
  await seedUsuarios(prisma);
});
after(async () => {
  await prisma.oferta.deleteMany({ where: { lote: { emergencia_id: { in: owned } } } });
  await prisma.lote.deleteMany({ where: { emergencia_id: { in: owned } } });
  await prisma.emergencia.deleteMany({ where: { id: { in: owned } } });
  await prisma.$disconnect();
});
let seq = BigInt(Date.now()) * 10000n;
async function fixture(enabled = true, options: StubOptions = {}, compatible = true, validationMode: 'PENDIENTE' | 'DESARROLLO' = 'DESARROLLO') {
  const caseId = String(++seq);
  const stub = await bonitaServer({ ...options, startBody: JSON.stringify({ caseId }) });
  const app = createApp(prisma, createBonitaService(enabled ? { ...stub.config, timeoutMs: 300 } : { enabled: false }), {
    compatibleProcessIds: compatible ? [PROCESS_ID] : [], callbackSecret: secret, validationMode,
  });
  const created = await request(app).post('/api/emergencias').set('X-Dev-User-Id', M).send({ creada_por_id: M, gravedad: 'ALTA', zona: 'Workflow ' + randomUUID(), descripcion: 'Prueba de sincronización' }).expect(201);
  const id = created.body.data.id as string; owned.push(id);
  const post = (action: string, actor: string = C, body: object = {}) => request(app).post(`/api/emergencias/${id}/acciones/${action}`)
    .set('X-Dev-User-Id', actor).send({ accionId: randomUUID(), ...body });
  const lote = async (cantidad = 10) => (await request(app).post(`/api/emergencias/${id}/lotes`).set('X-Dev-User-Id', C)
    .send({ tipo: 'RECURSO', descripcion: 'Raciones ' + randomUUID(), cantidad_requerida: cantidad, unidad: 'raciones' }).expect(201)).body.data;
  const oferta = (loteId: string, actor: string, cantidad: number) => request(app).post(`/api/lotes/${loteId}/ofertas`).set('X-Dev-User-Id', actor)
    .send({ ong_usuario_id: actor, cantidad_ofrecida: cantidad });
  const callback = (kind: string, activityId: string, body: object = {}) => request(app).post(`/api/internal/bonita/emergencias/${id}/convocatoria/${kind}`)
    .set('Authorization', 'Bearer ' + secret).send({ caseId, actividadId: activityId, ...body });
  const open = async () => {
    const task = stub.tasks.find(t => t.caseId === caseId && t.name === 'Cargar o editar ofertas' && t.state === 'ready')!;
    assert.ok(task);
    await callback('abrir', task.id, { duracionMs: 3600000 }).expect(200); return task.id;
  };
  const expire = async (activityId: string, recipients?: string[]) => {
    await prisma.ventanaConvocatoria.update({ where: { actividad_id: activityId }, data: { vence_at: new Date(0) } });
    const response = await callback('evaluar', activityId).expect(200);
    stub.expire(caseId, response.body.data.lotesCubiertos, recipients); return response.body.data;
  };
  return { id, caseId, app, stub, created, post, lote, oferta, callback, open, expire };
}

describe('Workflow, PostgreSQL y motor Bonita falso', () => {
  it('1.6 envía solo las ONG adjudicadas, sin duplicados, al terminar el monitoreo', async () => {
    const f = await fixture(true, { alternativeDecision: true, monitorRecipientsContract: true });
    try {
      const l1 = await f.lote(); const l2 = await f.lote();
      await f.post('publicar').expect(200); const window = await f.open();
      const a1 = (await f.oferta(l1.id, A, 4).expect(201)).body.data;
      const a2 = (await f.oferta(l2.id, A, 4).expect(201)).body.data;
      await f.oferta(l1.id, B, 2).expect(201);
      await f.expire(window);
      await f.post('decidir', C, { decisionCurso: 'CONTINUAR_PARCIAL' }).expect(200);
      await f.post('finalizar-monitoreo').expect(409);
      await f.post('ver-ofertas', M).expect(200);
      await f.post('adjudicar', M, { ofertaIds: [a1.id, a2.id] }).expect(200);
      assert.equal(f.stub.tasks.filter(t => t.name === 'Marcar actividad finalizada').length, 0);
      await f.post('finalizar-monitoreo', C, { ongDestinatariosInput: [B] }).expect(400);
      f.stub.options.delayExecutionMs = 650;
      const monitor = await f.post('finalizar-monitoreo').expect(200);
      assert.equal(monitor.body.data.estado, 'DESCONOCIDO');
      assert.deepEqual(monitor.body.data.contrato, { ongDestinatariosInput: [A] });
      const reconciled = await request(f.app).post(`/api/emergencias/${f.id}/acciones/${monitor.body.data.id}/reconciliar`)
        .set('X-Dev-User-Id', C).send({}).expect(200);
      assert.equal(reconciled.body.data.estado, 'CONFIRMADO');
      const executions = f.stub.requests.filter(r => r.path.includes(`/${monitor.body.data.task_id}/execution?`));
      assert.equal(executions.length, 1);
      assert.deepEqual(JSON.parse(executions[0]!.body), { ongDestinatariosInput: [A] });
      const tasks = f.stub.tasks.filter(t => t.name === 'Marcar actividad finalizada' && t.state === 'ready');
      assert.deepEqual(tasks.map(t => t.ongUsuarioId), [A]);
      f.stub.options.delayExecutionMs = 0;
      await f.post('leer', B).expect(403);
      await f.post('leer', A).expect(200);
      await f.post('finalizar-actividad', A).expect(200);
      await f.post('cerrar').expect(200);
      const state = (await request(f.app).get(`/api/emergencias/${f.id}/workflow`).expect(200)).body.data;
      assert.equal(state.state, 'COMPLETED');
    } finally { await f.stub.close(); }
  });
  for (const monitorFirst of [true, false]) it(`recorrido completo con dos ONG y monitoreo ${monitorFirst ? 'antes' : 'después'} de actividades`, async () => {
    const f = await fixture();
    try {
      assert.equal(f.created.body.warnings, undefined);
      assert.equal(f.stub.tasks.find(t => t.state === 'ready')?.name, 'Generar y publicar lotes');
      const l = await f.lote();
      assert.equal(f.stub.requests.filter(r => r.path.includes('/execution')).length, 1);
      await f.oferta(l.id, A, 4).expect(409);
      await f.post('publicar').expect(200);
      const window = await f.open();
      const executionCount = f.stub.requests.filter(r => r.path.includes('/execution')).length;
      const a = (await f.oferta(l.id, A, 4).expect(201)).body.data;
      const b = (await f.oferta(l.id, B, 6).expect(201)).body.data;
      assert.equal(f.stub.requests.filter(r => r.path.includes('/execution')).length, executionCount);
      assert.equal((await calculateCoverage(prisma, f.id)).lotesCubiertos, true);
      const coverage = await f.expire(window, [A, B]); assert.equal(coverage.lotesCubiertos, true);
      await f.oferta(l.id, A, 1).expect(409);
      assert.deepEqual((await f.callback('evaluar', window).expect(200)).body.data, coverage);
      await f.post('ver-ofertas', M).expect(200);
      const selection = await f.post('adjudicar', M, { ofertaIds: [a.id, b.id] }).expect(200);
      assert.equal(selection.body.data.estado, 'CONFIRMADO');
      assert.equal(selection.body.data.task_id, null);
      const repeat = await f.post('adjudicar', M, { accionId: selection.body.data.id, ofertaIds: [b.id, a.id] }).expect(200);
      assert.equal(repeat.body.data.id, selection.body.data.id);
      await f.post('adjudicar', M, { ofertaIds: [a.id] }).expect(409);
      const before = (await request(f.app).get(`/api/emergencias/${f.id}/workflow`).expect(200)).body.data;
      assert.equal(before.readyTasks.length, 3);
      assert.ok(before.readyTasks.some((t: { name: string }) => t.name === 'Monitorear despliegue'));
      assert.deepEqual(new Set(before.readyTasks.filter((t: { name: string }) => t.name === 'Marcar actividad finalizada').map((t: { ongUsuarioId: string }) => t.ongUsuarioId)), new Set([A, B]));
      assert.ok(before.availableActions.includes('ver-ofertas'));
      assert.ok(before.availableActions.includes('adjudicar'));
      assert.ok(before.availableActions.includes('finalizar-monitoreo'));
      assert.ok(before.availableActions.includes('finalizar-actividad'));
      assert.ok(!before.availableActions.includes('decidir'));
      await f.post('leer', A).expect(200);
      await f.post('leer', B).expect(200);
      if (monitorFirst) await f.post('finalizar-monitoreo').expect(200);
      await f.post('finalizar-actividad', A).expect(200);
      await f.post('cerrar').expect(409);
      await f.post('finalizar-actividad', B).expect(200);
      if (!monitorFirst) await f.post('finalizar-monitoreo').expect(200);
      await f.post('cerrar').expect(200);
      const state = (await request(f.app).get(`/api/emergencias/${f.id}/workflow`).expect(200)).body.data;
      assert.equal(state.state, 'COMPLETED'); assert.equal(state.localClosed, true); assert.deepEqual(state.readyTasks, []);
      assert.equal(f.stub.requests.filter(r => r.path.endsWith('/instantiation')).length, 1);
      const monitor = (await request(f.app).get(`/api/emergencias/${f.id}/monitoreo`).expect(200)).body.data;
      assert.equal(monitor.rondas[0].participaciones.filter((p: { finalizada_at: string }) => p.finalizada_at).length, 2);
    } finally { await f.stub.close(); }
  });
  it('sin cobertura reformula vía nueva-ronda al reaparecer Generar y publicar lotes', async () => {
    const f = await fixture();
    try {
      const l = await f.lote(); await f.post('publicar').expect(200); const first = await f.open();
      const offer = (await f.oferta(l.id, A, 3).expect(201)).body.data;
      const coverage = await f.expire(first);
      assert.equal(coverage.lotesCubiertos, false);
      assert.equal(f.stub.tasks.find(t => t.state === 'ready')?.name, 'Generar y publicar lotes');
      const workflow = (await request(f.app).get(`/api/emergencias/${f.id}/workflow`).expect(200)).body.data;
      assert.deepEqual(workflow.availableActions, ['nueva-ronda']);
      for (const action of ['ver-ofertas', 'adjudicar']) {
        const blocked = await f.post(action, M, action === 'adjudicar' ? { ofertaIds: [offer.id] } : {}).expect(409);
        assert.equal(blocked.body.error.code, 'ROUND_REFORMULATION_REQUIRED');
      }
      const oldRound = await prisma.ronda.findFirstOrThrow({ where: { emergencia_id: f.id } });
      assert.equal(oldRound.ofertas_vistas_at, null);
      assert.equal(oldRound.seleccionada_at, null);
      const response = await request(f.app).post(`/api/emergencias/${f.id}/acciones/nueva-ronda`).set('X-Dev-User-Id', C).send({}).expect(200);
      assert.equal(response.body.data.numero, 2);
      await request(f.app).post(`/api/emergencias/${f.id}/acciones/nueva-ronda`).set('X-Dev-User-Id', C).send({}).expect(200);
      assert.equal(await prisma.ronda.count({ where: { emergencia_id: f.id } }), 2);
      assert.equal(await prisma.oferta.count({ where: { lote_id: l.id } }), 1);
      assert.equal((await calculateCoverage(prisma, f.id)).lotesCubiertos, false);
      assert.equal((await f.callback('evaluar', first).expect(200)).body.data.lotes[0].cantidadOfrecida, 3);
      await f.lote(4); await f.post('publicar').expect(200); await f.open();
      await f.oferta(l.id, A, 1).expect(409);
      assert.equal(f.stub.requests.filter(r => r.path.endsWith('/instantiation')).length, 1);
    } finally { await f.stub.close(); }
  });
  it('sin Bonita permite adjudicar menos de lo requerido y rechaza excedentes e inactivas', async () => {
    const f = await fixture(false);
    try {
      const l = await f.lote(); await f.post('publicar').expect(200);
      const a = (await f.oferta(l.id, A, 4).expect(201)).body.data;
      const b = (await f.oferta(l.id, B, 8).expect(201)).body.data;
      await prisma.oferta.update({ where: { id: b.id }, data: { activa: false } });
      assert.equal((await calculateCoverage(prisma, f.id)).lotesCubiertos, false);
      await f.post('ver-ofertas', M).expect(200);
      await f.post('adjudicar', M, { ofertaIds: [b.id] }).expect(422);
      await prisma.oferta.update({ where: { id: b.id }, data: { activa: true } });
      await f.post('adjudicar', M, { ofertaIds: [a.id, b.id] }).expect(422);
      await f.post('adjudicar', M, { ofertaIds: [a.id, a.id] }).expect(422);
      await f.post('adjudicar', M, { ofertaIds: [randomUUID()] }).expect(422);
      await f.post('adjudicar', M, { ofertaIds: [a.id] }).expect(200);
      await f.post('leer', B).expect(403);
    } finally { await f.stub.close(); }
  });
  for (const decisionCurso of ['CONTINUAR_PARCIAL', 'REABRIR', 'REFORMULAR']) it(`decisión 1.6: ${decisionCurso}`, async () => {
    const f = await fixture(true, { alternativeDecision: true });
    try {
      const lot = await f.lote(); await f.post('publicar').expect(200); const first = await f.open();
      const offer = (await f.oferta(lot.id, A, 4).expect(201)).body.data;
      await f.post('ver-ofertas', M).expect(409);
      await f.expire(first);
      const state = (await request(f.app).get(`/api/emergencias/${f.id}/workflow`).expect(200)).body.data;
      assert.deepEqual(state.availableActions, ['decidir']);
      await f.post('ver-ofertas', M).expect(409);
      await f.post('adjudicar', M, { ofertaIds: [offer.id] }).expect(409);
      await f.post('decidir', M, { decisionCurso }).expect(403);
      await f.post('decidir', C, { decisionCurso: 'INVALIDA' }).expect(400);
      const chosen = await f.post('decidir', C, { decisionCurso }).expect(200);
      assert.deepEqual(chosen.body.data.contrato, { decisionCurso });
      const repeat = await f.post('decidir', C, { decisionCurso, accionId: chosen.body.data.id }).expect(200);
      assert.equal(repeat.body.data.id, chosen.body.data.id);
      await f.post('decidir', C, { decisionCurso: decisionCurso === 'REABRIR' ? 'REFORMULAR' : 'REABRIR', accionId: chosen.body.data.id }).expect(409);
      const after = (await request(f.app).get(`/api/emergencias/${f.id}/workflow`).expect(200)).body.data;
      if (decisionCurso === 'CONTINUAR_PARCIAL') {
        assert.ok(after.availableActions.includes('adjudicar'));
        await f.post('ver-ofertas', M).expect(200);
        await f.post('adjudicar', M, { ofertaIds: [offer.id] }).expect(200);
      } else if (decisionCurso === 'REABRIR') {
        assert.ok(!after.availableActions.includes('adjudicar'));
        await f.post('ver-ofertas', M).expect(409);
        const second = await f.open();
        assert.notEqual(first, second);
        assert.equal(await prisma.ronda.count({ where: { emergencia_id: f.id } }), 1);
        assert.equal(await prisma.lote.count({ where: { emergencia_id: f.id } }), 1);
        assert.equal(await prisma.oferta.count({ where: { lote_id: lot.id } }), 1);
        await f.oferta(lot.id, B, 6).expect(201);
        const coverage = await f.expire(second, [A, B]);
        assert.equal(coverage.lotesCubiertos, true);
        const oldCoverage = await f.callback('evaluar', first).expect(200);
        assert.equal(oldCoverage.body.data.lotesCubiertos, false);
        assert.equal(oldCoverage.body.data.lotes[0].cantidadOfrecida, 4);
        await f.post('ver-ofertas', M).expect(200);
      } else {
        assert.deepEqual(after.availableActions, ['nueva-ronda']);
        await request(f.app).post(`/api/emergencias/${f.id}/acciones/nueva-ronda`).set('X-Dev-User-Id', C).send({}).expect(200);
        assert.equal(await prisma.ronda.count({ where: { emergencia_id: f.id } }), 2);
        assert.equal(await prisma.oferta.count({ where: { lote_id: lot.id } }), 1);
        await f.lote(6); await f.post('publicar').expect(200); await f.open();
      }
      assert.equal(f.stub.requests.filter(r => r.path.includes(`/${chosen.body.data.task_id}/execution?`)).length, 1);
    } finally { await f.stub.close(); }
  });
  it('no acepta cobertura parcial sin ofertas y reconcilia una decisión con timeout sin repetirla', async () => {
    const f = await fixture(true, { alternativeDecision: true });
    try {
      await f.lote(); await f.post('publicar').expect(200); const first = await f.open(); await f.expire(first);
      const empty = await f.post('decidir', C, { decisionCurso: 'CONTINUAR_PARCIAL' }).expect(409);
      assert.equal(empty.body.error.code, 'NO_OFFERS');
      f.stub.options.delayExecutionMs = 650;
      const chosen = await f.post('decidir', C, { decisionCurso: 'REABRIR' }).expect(200);
      assert.equal(chosen.body.data.estado, 'DESCONOCIDO');
      const retried = await request(f.app).post(`/api/emergencias/${f.id}/acciones/${chosen.body.data.id}/reconciliar`)
        .set('X-Dev-User-Id', C).send({}).expect(200);
      assert.equal(retried.body.data.estado, 'CONFIRMADO');
      assert.equal(f.stub.requests.filter(r => r.path.includes(`/${chosen.body.data.task_id}/execution?`)).length, 1);
    } finally { await f.stub.close(); }
  });
  it('fallo después de guardar conserva datos y reconcilia la tarea exacta sin otra ejecución', async () => {
    const f = await fixture();
    try {
      await f.lote();
      f.stub.options.delayExecutionMs = 650;
      const response = await f.post('publicar').expect(200);
      assert.equal(response.body.warnings[0].code, 'BONITA_TIMEOUT');
      assert.ok((await prisma.ronda.findFirstOrThrow({ where: { emergencia_id: f.id } })).publicada_at);
      const count = f.stub.requests.filter(r => r.path.includes('/execution')).length;
      f.stub.options.delayExecutionMs = 0;
      const reconciled = await request(f.app).post(`/api/emergencias/${f.id}/acciones/${response.body.data.id}/reconciliar`).set('X-Dev-User-Id', C).send({}).expect(200);
      assert.equal(reconciled.body.data.estado, 'CONFIRMADO');
      assert.equal(f.stub.requests.filter(r => r.path.includes('/execution')).length, count);
      assert.equal(f.stub.requests.filter(r => r.path.endsWith('/instantiation')).length, 1);
    } finally { await f.stub.close(); }
  });
  it('rechazo HTTP persistido se reintenta sobre la misma tarea; doble envío concurrente ejecuta una vez', async () => {
    const f = await fixture();
    try {
      await f.lote(); f.stub.options.executionStatus = 403;
      const rejected = await f.post('publicar').expect(200);
      assert.equal(rejected.body.data.estado, 'RECHAZADO');
      f.stub.options.executionStatus = 204;
      const actionId = rejected.body.data.id;
      const responses = await Promise.all([f.post('publicar', C, { accionId: actionId }), f.post('publicar', C, { accionId: actionId })]);
      assert.ok(responses.every(r => r.status === 200));
      const executions = f.stub.requests.filter(r => r.path.includes('/execution') && r.path.includes(rejected.body.data.task_id));
      assert.equal(executions.length, 2); // One rejected request, one successful request.
    } finally { await f.stub.close(); }
  });
  it('resultado desconocido sin archivo permanece pendiente y nunca reenvía una ejecución', async () => {
    const f = await fixture();
    try {
      await f.lote(); f.stub.options.executionStatus = 500;
      const response = await f.post('publicar').expect(200);
      assert.equal(response.body.data.estado, 'DESCONOCIDO');
      const count = f.stub.requests.filter(r => r.path.includes('/execution')).length;
      f.stub.options.executionStatus = 204;
      const retry = await f.post('publicar', C, { accionId: response.body.data.id }).expect(200);
      assert.equal(retry.body.warnings[0].code, 'BONITA_RESULT_UNKNOWN');
      assert.equal(f.stub.requests.filter(r => r.path.includes('/execution')).length, count);
      assert.equal((await prisma.accionWorkflow.findUniqueOrThrow({ where: { id: response.body.data.id } })).estado, 'DESCONOCIDO');
    } finally { await f.stub.close(); }
  });
  it('bloquea definición incompatible y contratos incompatibles sin habilitar el timer', async () => {
    const f = await fixture(true, {}, false);
    try {
      await f.lote(); const response = await f.post('publicar').expect(409);
      assert.equal(response.body.error.code, 'BPMN_INCOMPATIBLE');
      assert.equal(f.stub.requests.filter(r => r.path.includes('/execution')).length, 1);
    } finally { await f.stub.close(); }
    const g = await fixture(true, { contractOverride: { inputs: [] } });
    try {
      assert.equal(g.created.body.warnings[0].code, 'BPMN_CONTRACT_INCOMPATIBLE');
      assert.ok((await prisma.emergencia.findUniqueOrThrow({ where: { id: g.id } })).bonita_instance_id);
      assert.equal(g.stub.requests.filter(r => r.path.includes('/execution')).length, 0);
    } finally { await g.stub.close(); }
  });
  it('valida roles, dueño, callbacks y lotes obligatorios', async () => {
    const f = await fixture();
    try {
      await f.post('publicar', U).expect(403);
      await f.post('publicar').expect(409);
      await request(f.app).post(`/api/emergencias/${f.id}/acciones/publicar`).send({ accionId: randomUUID() }).expect(401);
      await f.lote(); await f.post('publicar').expect(200);
      const task = f.stub.tasks.find(t => t.name === 'Cargar o editar ofertas')!;
      await request(f.app).post(`/api/internal/bonita/emergencias/${f.id}/convocatoria/abrir`).send({ caseId: f.caseId, actividadId: task.id, duracionMs: 1000 }).expect(401);
      await f.callback('abrir', task.id, { caseId: '1', duracionMs: 1000 }).expect(403);
      await f.callback('abrir', task.id, { duracionMs: 10000 }).expect(200);
      await f.callback('evaluar', task.id).expect(409);
      const stranger = await prisma.usuario.create({ data: { nombre: 'Municipio ajeno', email: randomUUID() + '@test.local', rol: 'MUNICIPIO', organizacion: 'Otro' } });
      try { await f.post('ver-ofertas', stranger.id).expect(403); } finally { await prisma.usuario.delete({ where: { id: stranger.id } }); }
    } finally { await f.stub.close(); }
  });
  it('serializa la oferta concurrente al cierre y congela el resultado de la ventana', async () => {
    const f = await fixture();
    try {
      const l = await f.lote(); await f.post('publicar').expect(200); const activityId = await f.open();
      await f.oferta(l.id, A, 4).expect(201);
      await prisma.ventanaConvocatoria.update({ where: { actividad_id: activityId }, data: { vence_at: new Date(0) } });
      const [offer, evaluated] = await Promise.all([f.oferta(l.id, B, 6), f.callback('evaluar', activityId)]);
      assert.equal(offer.status, 409); assert.equal(evaluated.status, 200);
      assert.equal(evaluated.body.data.lotes[0].cantidadOfrecida, 4);
      await prisma.oferta.updateMany({ where: { lote_id: l.id }, data: { activa: false } });
      assert.deepEqual((await f.callback('evaluar', activityId).expect(200)).body.data, evaluated.body.data);
    } finally { await f.stub.close(); }
  });
  it('espera el pequeño desfase del timer antes de evaluar sin cerrar anticipadamente', async () => {
    const f = await fixture();
    try {
      const l = await f.lote(); await f.post('publicar').expect(200); const activityId = await f.open();
      await f.oferta(l.id, A, 10).expect(201);
      const deadline = new Date(Date.now() + 500);
      await prisma.ventanaConvocatoria.update({ where: { actividad_id: activityId }, data: { vence_at: deadline } });
      const evaluated = await f.callback('evaluar', activityId).expect(200);
      const window = await prisma.ventanaConvocatoria.findUniqueOrThrow({ where: { actividad_id: activityId } });
      assert.ok(window.cerrada_at!.getTime() >= deadline.getTime());
      assert.equal(evaluated.body.data.lotesCubiertos, true);
      assert.deepEqual((await f.callback('evaluar', activityId).expect(200)).body.data, evaluated.body.data);
    } finally { await f.stub.close(); }
  });
  it('modo desacoplado realiza operaciones locales sin ninguna llamada HTTP Bonita', async () => {
    const f = await fixture(false);
    try {
      const l = await f.lote(); await f.post('publicar').expect(200);
      const a = (await f.oferta(l.id, A, 3).expect(201)).body.data;
      await f.post('decidir', C, { cursoAccion: 'PARCIAL' }).expect(400);
      await f.post('decidir', C, { decisionCurso: 'CONTINUAR_PARCIAL' }).expect(409);
      await f.post('ver-ofertas', M).expect(200);
      await f.post('adjudicar', M, { ofertaIds: [a.id] }).expect(200);
      await f.post('leer', B).expect(403);
      await f.post('finalizar-actividad', A).expect(409);
      await f.post('leer', A).expect(200);
      await f.post('cerrar').expect(409);
      await f.post('finalizar-monitoreo').expect(200);
      await f.post('finalizar-actividad', A).expect(200);
      await f.post('cerrar').expect(200);
      const data = (await request(f.app).get(`/api/emergencias/${f.id}/workflow`).expect(200)).body.data;
      assert.equal(data.state, 'DISABLED'); assert.equal(data.localClosed, true);
      assert.ok(!data.availableActions.includes('decidir'));
      assert.equal(f.stub.requests.length, 0);
    } finally { await f.stub.close(); }
  });
  it('validación externa predeterminada pendiente impide afirmar ofertas válidas', async () => {
    const f = await fixture(false, {}, true, 'PENDIENTE');
    try {
      await f.lote(); await f.post('publicar').expect(200);
      const response = await f.post('ver-ofertas', M).expect(409);
      assert.equal(response.body.error.code, 'VALIDACION_PENDIENTE');
    } finally { await f.stub.close(); }
  });
});

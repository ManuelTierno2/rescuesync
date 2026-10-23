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
import { createSnClient } from '../src/integrations/sistema-nacional/sn.client.js';
import { bonitaServer, PROCESS_ID } from './helpers/bonita-server.js';
import { snServer, type SnStubOptions } from './helpers/sn-server.js';
import { testDatabaseUrl } from './helpers/test-database.js';
import { seedUsuarios, MUNICIPIO_DEMO_ID as M, COORDINADOR_DEMO_ID as C, ONG_A_DEMO_ID as A, ONG_B_DEMO_ID as B } from '../prisma/seed.js';

const dbUrl = testDatabaseUrl();
const prisma = createPrismaClient(dbUrl);
const secret = 'sn-integration-test-secret-0000000000';
const owned: string[] = [];
const ownedItems: string[] = [];

before(async () => {
  await promisify(execFile)(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: dbUrl }, windowsHide: true,
  });
  await seedUsuarios(prisma);
});
after(async () => {
  await prisma.ofertaValidacion.deleteMany({ where: { ventana: { ronda: { emergencia_id: { in: owned } } } } });
  await prisma.oferta.deleteMany({ where: { lote: { emergencia_id: { in: owned } } } });
  await prisma.inventarioItem.deleteMany({ where: { id: { in: ownedItems } } });
  await prisma.lote.deleteMany({ where: { emergencia_id: { in: owned } } });
  await prisma.emergencia.deleteMany({ where: { id: { in: owned } } });
  await prisma.$disconnect();
});

let seq = BigInt(Date.now()) * 10000n + 777n;

async function fixture(compromisoStatus?: number, snOptions: SnStubOptions = {}) {
  const caseId = String(++seq);
  const stub = await bonitaServer({ startBody: JSON.stringify({ caseId }), alternativeDecision: true });
  const sn = await snServer({ compromisoStatus, ...snOptions });
  const app = createApp(prisma, createBonitaService({ ...stub.config, timeoutMs: 300 }), {
    compatibleProcessIds: [PROCESS_ID], callbackSecret: secret, validationMode: 'PENDIENTE',
    sn: createSnClient(sn.config),
  });
  const created = await request(app).post('/api/emergencias').set('X-Dev-User-Id', M)
    .send({ creada_por_id: M, gravedad: 'ALTA', zona: 'SN ' + randomUUID(), descripcion: 'Integración SN' }).expect(201);
  const id = created.body.data.id as string; owned.push(id);
  const post = (action: string, actor: string = C, body: object = {}) => request(app)
    .post(`/api/emergencias/${id}/acciones/${action}`).set('X-Dev-User-Id', actor).send({ accionId: randomUUID(), ...body });
  const lote = async (cantidad = 10) => (await request(app).post(`/api/emergencias/${id}/lotes`).set('X-Dev-User-Id', C)
    .send({ tipo: 'RECURSO', descripcion: 'Raciones ' + randomUUID(), cantidad_requerida: cantidad, unidad: 'raciones' }).expect(201)).body.data;
  const inventario = async (actor: string, codigoSn: string, cantidad = 50) => {
    const item = (await request(app).post('/api/inventario')
      .set('X-Dev-User-Id', actor).send({ tipo: 'RECURSO', descripcion: 'Stock ' + randomUUID(), cantidad, unidad: 'raciones', codigoSn }).expect(201)).body.data;
    ownedItems.push(item.id);
    return item;
  };
  const oferta = (loteId: string, actor: string, cantidad: number, inventarioId: string) => request(app)
    .post(`/api/lotes/${loteId}/ofertas`).set('X-Dev-User-Id', actor)
    .send({ ong_usuario_id: actor, cantidad_ofrecida: cantidad, inventario_item_id: inventarioId });
  const callbackSn = (kind: string, activityId: string, body: object = {}) => request(app)
    .post(`/api/internal/bonita/emergencias/${id}/convocatoria/${kind}`).set('Authorization', 'Bearer ' + secret)
    .send({ caseId, actividadId: activityId, ...body });
  const open = async () => {
    const task = stub.tasks.find(t => t.caseId === caseId && t.name === 'Cargar o editar ofertas' && t.state === 'ready')!;
    assert.ok(task);
    await request(app).post(`/api/internal/bonita/emergencias/${id}/convocatoria/abrir`)
      .set('Authorization', 'Bearer ' + secret).send({ caseId, actividadId: task.id, duracionMs: 3600000 }).expect(200);
    return task.id;
  };
  const close = async () => { await stub.close(); await sn.close(); };
  /** Simula el avance del proceso tras el XOR: si no cubrió, el coordinador decide continuar parcial. */
  const avanzar = async (lotesCubiertos: boolean) => {
    stub.expire(caseId, lotesCubiertos, [A]);
    if (!lotesCubiertos) await post('decidir', C, { decisionCurso: 'CONTINUAR_PARCIAL' }).expect(200);
  };
  return { id, caseId, app, stub, sn, post, lote, inventario, oferta, callbackSn, open, avanzar, close };
}

const resultado = (ofertaId: string, ongId: string, r: string, cantidadValida: number) => ({
  ofertaId, ongId, tipoRecurso: 'RACION_ALIMENTO', cantidad: 0, nivelRiesgo: 'ALTO',
  resultado: r, cantidadValida, nivelRiesgoMax: 'ALTO', disponible: 50, motivo: 'stub',
});

describe('Integración Sistema Nacional (stub HTTP)', () => {
  it('payload, persistencia, cobertura APOYO, gating, compromiso y liberación', async () => {
    const f = await fixture();
    try {
      const l = await f.lote(10);
      await f.post('publicar').expect(200);
      const window = await f.open();
      const invA = await f.inventario(A, 'RACION_ALIMENTO');
      const a = (await f.oferta(l.id, A, 6, invA.id).expect(201)).body.data;
      const invB = await f.inventario(B, 'RACION_ALIMENTO');
      const b = (await f.oferta(l.id, B, 6, invB.id).expect(201)).body.data;
      // Dato legado: el ítem pierde su código (la API ya no lo permite) → la oferta queda sin mapeo.
      await prisma.inventarioItem.update({ where: { id: invB.id }, data: { codigo_sn: null } });

      const estado = async () => (await request(f.app).get(`/api/emergencias/${f.id}/workflow`).set('X-Dev-User-Id', M).expect(200)).body.data;
      const antes = await estado();
      assert.equal(antes.seleccionHabilitada, false); // PENDIENTE y sin validación del SN
      assert.ok(!antes.availableActions.includes('adjudicar'));

      const payload = (await f.callbackSn('ofertas-validacion', window).expect(200)).body.data;
      assert.equal(payload.nivelRiesgo, 'ALTO');
      assert.deepEqual(payload.ofertas.map((o: { ofertaId: string }) => o.ofertaId), [a.id]);
      assert.equal(payload.ofertas[0].tipoRecurso, 'RACION_ALIMENTO');
      assert.deepEqual(payload.sinMapeo, [b.id]);
      assert.ok(f.sn.calls.some(c => c.path === '/ongs'), 'sync de ONG al SN');

      const cobertura = (await f.callbackSn('validacion-resultado', window, {
        resultados: [resultado(a.id, A, 'PARCIAL', 6)],
      }).expect(200)).body.data;
      assert.equal(cobertura.lotesCubiertos, false); // 6 válidas < 10 requeridas
      await f.avanzar(false);

      const lista = (await request(f.app).get(`/api/emergencias/${f.id}/validaciones`).expect(200)).body.data;
      assert.equal(lista.length, 2);
      assert.equal(lista.find((v: { oferta_id: string }) => v.oferta_id === b.id).resultado, 'SIN_CAPACIDAD');

      const despues = await estado();
      assert.equal(despues.validacionSn, true);
      assert.equal(despues.seleccionHabilitada, true); // PENDIENTE pero validado por el SN
      assert.ok(despues.availableActions.includes('ver-ofertas') && despues.availableActions.includes('adjudicar'));
      const monitor = (await request(f.app).get(`/api/emergencias/${f.id}/monitoreo`).set('X-Dev-User-Id', M).expect(200)).body.data;
      const ofertasMon = monitor.rondas[0].lotes.flatMap((x: { ofertas: { id: string; validacion_actual: { resultado: string } | null }[] }) => x.ofertas);
      assert.equal(ofertasMon.find((o: { id: string }) => o.id === a.id).validacion_actual.resultado, 'PARCIAL');
      assert.equal(ofertasMon.find((o: { id: string }) => o.id === b.id).validacion_actual.resultado, 'SIN_CAPACIDAD');

      await f.post('ver-ofertas', M).expect(200); // sin DESARROLLO: hay validación SN
      await f.post('adjudicar', M, { ofertaIds: [b.id] }).expect(422); // SIN_CAPACIDAD
      await f.post('adjudicar', M, { ofertaIds: [a.id] }).expect(200);
      const compromiso = f.sn.calls.find(c => c.path === '/compromisos');
      assert.ok(compromiso);
      assert.equal((compromiso.body.items as { cantidad: number }[])[0]!.cantidad, 6);
      const adjudicacion = await prisma.adjudicacion.findFirst({ where: { oferta_id: a.id } });
      assert.ok(adjudicacion?.sn_compromiso_id);

      f.stub.addTask(f.caseId, 'Marcar actividad finalizada', A); // tarea que Bonita crea para la ONG adjudicada
      await f.post('leer', A).expect(200);
      await f.post('finalizar-actividad', A).expect(200);
      await f.post('finalizar-monitoreo').expect(200);
      // Aunque Bonita ya haya archivado el caso, el coordinador debe poder cerrar el operativo (y liberar en el SN).
      f.stub.cases.get(f.caseId)!.completed = true;
      const final = await estado();
      assert.equal(final.state, 'COMPLETED');
      assert.ok(final.availableActions.includes('cerrar'), `cerrar disponible (estado ${final.state})`);
      await f.post('cerrar').expect(200);
      assert.ok(f.sn.calls.some(c => c.path === '/compromisos/liberar'), 'liberación al cerrar');
    } finally { await f.close(); }
  });

  it('APOYO no cubre el lote pero queda registrado como apoyo', async () => {
    const f = await fixture();
    try {
      const l = await f.lote(10);
      await f.post('publicar').expect(200);
      const window = await f.open();
      const invA = await f.inventario(A, 'RACION_ALIMENTO');
      const a = (await f.oferta(l.id, A, 10, invA.id).expect(201)).body.data;
      await f.callbackSn('ofertas-validacion', window).expect(200);
      const cobertura = (await f.callbackSn('validacion-resultado', window, {
        resultados: [resultado(a.id, A, 'APOYO', 10)],
      }).expect(200)).body.data;
      assert.equal(cobertura.lotesCubiertos, false);
      const lista = (await request(f.app).get(`/api/emergencias/${f.id}/validaciones`).expect(200)).body.data;
      assert.equal(lista[0].apoyo, true);
    } finally { await f.close(); }
  });

  it('el SN rechaza a una ONG: no aborta, queda SIN_CAPACIDAD con el motivo y las demás se validan', async () => {
    const f = await fixture(undefined, { rejectOngs: [B] });
    try {
      const l = await f.lote(10);
      await f.post('publicar').expect(200);
      const window = await f.open();
      const invA = await f.inventario(A, 'RACION_ALIMENTO');
      const invB = await f.inventario(B, 'RACION_ALIMENTO');
      const a = (await f.oferta(l.id, A, 6, invA.id).expect(201)).body.data;
      const b = (await f.oferta(l.id, B, 6, invB.id).expect(201)).body.data;

      const payload = (await f.callbackSn('ofertas-validacion', window).expect(200)).body.data;
      assert.deepEqual(payload.ofertas.map((o: { ofertaId: string }) => o.ofertaId), [a.id]);
      assert.deepEqual(payload.rechazadasPorSn, [b.id]);

      await f.callbackSn('validacion-resultado', window, { resultados: [resultado(a.id, A, 'COMPLETA', 6)] }).expect(200);
      const lista = (await request(f.app).get(`/api/emergencias/${f.id}/validaciones`).expect(200)).body.data;
      assert.equal(lista.length, 2);
      const vb = lista.find((v: { oferta_id: string }) => v.oferta_id === b.id);
      assert.equal(vb.resultado, 'SIN_CAPACIDAD');
      assert.match(vb.motivo, /rechazó la sincronización/);
      assert.equal(lista.find((v: { oferta_id: string }) => v.oferta_id === a.id).resultado, 'COMPLETA');
    } finally { await f.close(); }
  });

  it('el catálogo de códigos sale del SN: un código nuevo queda disponible y los que el SN no tiene se rechazan', async () => {
    const f = await fixture();
    try {
      const catalogo = (await request(f.app).get('/api/inventario/codigos-sn').set('X-Dev-User-Id', A).expect(200)).body;
      assert.equal(catalogo.origen, 'SN');
      assert.ok(catalogo.data.some((t: { codigo: string }) => t.codigo === 'BOMBERO'), 'código que el back no conocía');
      assert.ok(!catalogo.data.some((t: { codigo: string }) => t.codigo === 'KIT_MEDICO'), 'solo lo que publica el SN');

      const crear = (codigoSn: string) => request(f.app).post('/api/inventario').set('X-Dev-User-Id', A)
        .send({ tipo: 'PERSONAL', descripcion: 'Brigada ' + randomUUID(), cantidad: 4, unidad: 'personas', codigoSn });
      const bombero = (await crear('BOMBERO').expect(201)).body.data;
      ownedItems.push(bombero.id);
      assert.equal(bombero.codigo_sn, 'BOMBERO');
      const rechazado = await crear('KIT_MEDICO').expect(422);
      assert.equal(rechazado.body.error.code, 'CODIGO_SN_INVALIDO');
      assert.ok(f.sn.calls.filter(c => c.path === '/tipos-recurso').length === 1, 'catálogo cacheado: una sola lectura al SN');
    } finally { await f.close(); }
  });

  it('si el SN no publica su catálogo y no hay copia previa responde 502 SN_CATALOG_FAILED', async () => {
    const f = await fixture(undefined, { tiposStatus: 500 });
    try {
      const res = await request(f.app).get('/api/inventario/codigos-sn').set('X-Dev-User-Id', A).expect(502);
      assert.equal(res.body.error.code, 'SN_CATALOG_FAILED');
    } finally { await f.close(); }
  });

  it('credenciales de servicio inválidas en el SN responden 502 SN_AUTH_FAILED', async () => {
    const f = await fixture(undefined, { loginStatus: 401 });
    try {
      const l = await f.lote(10);
      await f.post('publicar').expect(200);
      const window = await f.open();
      // El alta de inventario consulta el catálogo del SN (que aquí rechaza el login): se siembra directo.
      const invA = await prisma.inventarioItem.create({
        data: { ong_usuario_id: A, tipo: 'RECURSO', descripcion: 'Stock ' + randomUUID(), cantidad: 50, unidad: 'raciones', codigo_sn: 'RACION_ALIMENTO' },
      });
      ownedItems.push(invA.id);
      await f.oferta(l.id, A, 6, invA.id).expect(201);
      const resp = await f.callbackSn('ofertas-validacion', window).expect(502);
      assert.equal(resp.body.error.code, 'SN_AUTH_FAILED');
    } finally { await f.close(); }
  });

  it('409 del SN al comprometer cancela la adjudicación local', async () => {
    const f = await fixture(409);
    try {
      const l = await f.lote(10);
      await f.post('publicar').expect(200);
      const window = await f.open();
      const invA = await f.inventario(A, 'RACION_ALIMENTO');
      const a = (await f.oferta(l.id, A, 10, invA.id).expect(201)).body.data;
      await f.callbackSn('ofertas-validacion', window).expect(200);
      await f.callbackSn('validacion-resultado', window, { resultados: [resultado(a.id, A, 'COMPLETA', 10)] }).expect(200);
      await f.avanzar(true);
      await f.post('ver-ofertas', M).expect(200);
      const resp = await f.post('adjudicar', M, { ofertaIds: [a.id] }).expect(409);
      assert.equal(resp.body.error?.code ?? resp.body.code, 'SN_COMPROMISO_RECHAZADO');
      assert.equal(await prisma.adjudicacion.count({ where: { oferta_id: a.id } }), 0);
    } finally { await f.close(); }
  });
});

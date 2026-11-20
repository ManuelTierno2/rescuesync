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
import { bonitaServer, PROCESS_ID } from './helpers/bonita-server.js';
import { testDatabaseUrl } from './helpers/test-database.js';
import { seedUsuarios, MUNICIPIO_DEMO_ID as M, COORDINADOR_DEMO_ID as C, ONG_A_DEMO_ID as A, ONG_B_DEMO_ID as B } from '../prisma/seed.js';

/**
 * RescueSync 1.8: el Sistema Nacional (validación, compromiso y liberación) lo invoca solo Bonita.
 * El back arma los pedidos y registra las respuestas que le reenvían los conectores; nunca llama al cloud.
 */
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

async function fixture() {
  const caseId = String(++seq);
  const stub = await bonitaServer({ startBody: JSON.stringify({ caseId }), alternativeDecision: true });
  const app = createApp(prisma, createBonitaService({ ...stub.config, timeoutMs: 300 }), {
    compatibleProcessIds: [PROCESS_ID], callbackSecret: secret, validationMode: 'PENDIENTE',
  });
  const created = await request(app).post('/api/emergencias').set('X-Dev-User-Id', M)
    .send({ creada_por_id: M, gravedad: 'ALTA', zona: 'SN ' + randomUUID(), descripcion: 'Orquestación SN' }).expect(201);
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
  const callback = (path: string, body: object = {}) => request(app)
    .post(`/api/internal/bonita/emergencias/${id}/${path}`).set('Authorization', 'Bearer ' + secret).send({ caseId, ...body });
  const open = async () => {
    const task = stub.tasks.find(t => t.caseId === caseId && t.name === 'Cargar o editar ofertas' && t.state === 'ready')!;
    assert.ok(task);
    await callback('convocatoria/abrir', { actividadId: task.id, duracionMs: 3600000 }).expect(200);
    return task.id;
  };
  const estado = async () => (await request(app).get(`/api/emergencias/${id}/workflow`).set('X-Dev-User-Id', M).expect(200)).body.data;
  return { id, caseId, app, stub, post, lote, inventario, oferta, callback, open, estado };
}

const resultado = (ofertaId: string, ongId: string, r: string, cantidadValida: number) => ({
  ofertaId, ongId, tipoRecurso: 'RACION_ALIMENTO', cantidad: 0, nivelRiesgo: 'ALTO',
  resultado: r, cantidadValida, nivelRiesgoMax: 'ALTO', disponible: 50, motivo: 'stub',
});

/** Prepara una ronda validada por el SN con una oferta COMPLETA de ONG A y deja lista la selección. */
async function validada(f: Awaited<ReturnType<typeof fixture>>, cantidad = 10) {
  const l = await f.lote(cantidad);
  await f.post('publicar').expect(200);
  const window = await f.open();
  const invA = await f.inventario(A, 'RACION_ALIMENTO');
  const a = (await f.oferta(l.id, A, cantidad, invA.id).expect(201)).body.data;
  await f.callback('convocatoria/ofertas-validacion', { actividadId: window }).expect(200);
  const cobertura = (await f.callback('convocatoria/validacion-resultado', { actividadId: window,
    resultados: [resultado(a.id, A, 'COMPLETA', cantidad)] }).expect(200)).body.data;
  f.stub.expire(f.caseId, cobertura.lotesCubiertos, [A]);
  return { l, a, window };
}

describe('Orquestación del Sistema Nacional por Bonita (1.8)', () => {
  it('validación: el back arma el JSON de ofertas sin llamar al SN y persiste el resultado que reenvía Bonita', async () => {
    const f = await fixture();
    try {
      const l = await f.lote(10);
      await f.post('publicar').expect(200);
      const window = await f.open();
      const invA = await f.inventario(A, 'RACION_ALIMENTO');
      const a = (await f.oferta(l.id, A, 6, invA.id).expect(201)).body.data;
      const invB = await f.inventario(B, 'RACION_ALIMENTO');
      const b = (await f.oferta(l.id, B, 6, invB.id).expect(201)).body.data;
      // Dato legado: el ítem pierde su código → la oferta queda sin mapeo y se registra SIN_CAPACIDAD.
      await prisma.inventarioItem.update({ where: { id: invB.id }, data: { codigo_sn: null } });

      const antes = await f.estado();
      assert.equal(antes.seleccionHabilitada, false);
      const payload = (await f.callback('convocatoria/ofertas-validacion', { actividadId: window }).expect(200)).body.data;
      assert.equal(payload.nivelRiesgo, 'ALTO');
      assert.deepEqual(payload.ofertas.map((o: { ofertaId: string }) => o.ofertaId), [a.id]);
      assert.deepEqual(payload.sinMapeo, [b.id]);
      assert.equal(payload.rechazadasPorSn, undefined, 'el back ya no sincroniza ONG en el SN');

      const cobertura = (await f.callback('convocatoria/validacion-resultado', { actividadId: window,
        resultados: [resultado(a.id, A, 'PARCIAL', 6)] }).expect(200)).body.data;
      assert.equal(cobertura.lotesCubiertos, false);
      const lista = (await request(f.app).get(`/api/emergencias/${f.id}/validaciones`).expect(200)).body.data;
      assert.equal(lista.find((v: { oferta_id: string }) => v.oferta_id === b.id).resultado, 'SIN_CAPACIDAD');
      assert.equal((await f.estado()).validacionSn, true);
    } finally { await f.stub.close(); }
  });

  it('APOYO no cubre el lote pero queda registrado como apoyo', async () => {
    const f = await fixture();
    try {
      const l = await f.lote(10);
      await f.post('publicar').expect(200);
      const window = await f.open();
      const invA = await f.inventario(A, 'RACION_ALIMENTO');
      const a = (await f.oferta(l.id, A, 10, invA.id).expect(201)).body.data;
      const cobertura = (await f.callback('convocatoria/validacion-resultado', { actividadId: window,
        resultados: [resultado(a.id, A, 'APOYO', 10)] }).expect(200)).body.data;
      assert.equal(cobertura.lotesCubiertos, false);
      const lista = (await request(f.app).get(`/api/emergencias/${f.id}/validaciones`).expect(200)).body.data;
      assert.equal(lista[0].apoyo, true);
    } finally { await f.stub.close(); }
  });

  it('compromiso: la selección espera la confirmación del SN; un 409 vuelve a la selección y la segunda se confirma', async () => {
    const f = await fixture();
    try {
      const { l, a } = await validada(f, 10);
      const listo = await f.estado();
      assert.ok(listo.availableActions.includes('ver-ofertas') && listo.availableActions.includes('adjudicar'));
      await f.post('ver-ofertas', M).expect(200);
      const seleccion = await f.post('adjudicar', M, { ofertaIds: [a.id] }).expect(200);
      assert.equal(seleccion.body.data.task_name, 'Seleccionar y adjudicar ofertas');
      assert.equal(await prisma.adjudicacion.count({ where: { oferta_id: a.id } }), 0, 'sin adjudicación hasta que el SN confirme');

      // Conector «Obtener compromisos»: un compromiso por lote y ONG con el código del catálogo nacional.
      const pedido = (await f.callback('adjudicacion/compromisos').expect(200)).body.data;
      assert.deepEqual(pedido, { emergenciaId: f.id, compromisos: [{ loteId: l.id, ongId: A, items: [{ tipoRecurso: 'RACION_ALIMENTO', cantidad: 10 }] }] });

      // El SN responde 409 (otra emergencia tomó el stock): Bonita vuelve a «Seleccionar y adjudicar ofertas».
      const rechazo = (await f.callback('adjudicacion/resultado', { status: 409, body: JSON.stringify({
        error: 'No se pudieron comprometer todos los recursos', detalle: [{ tipoRecurso: 'RACION_ALIMENTO', solicitado: 10, disponible: 4, motivo: 'Disponible 4 de 10' }],
      }) }).expect(200)).body.data;
      assert.equal(rechazo.compromisoOk, false);
      assert.match(rechazo.motivo, /pedido 10, disponible 4/);
      // Un reintento del conector devuelve lo mismo.
      assert.equal((await f.callback('adjudicacion/resultado', { status: 409, body: '{}' }).expect(200)).body.data.compromisoOk, false);
      f.stub.compromiso(f.caseId, false);
      const rechazada = await f.estado();
      assert.equal(rechazada.compromiso.estado, 'RECHAZADO');
      assert.match(rechazada.compromiso.motivo, /RACION_ALIMENTO/);
      assert.equal(await prisma.adjudicacion.count({ where: { oferta_id: a.id } }), 0);

      // El municipio vuelve a seleccionar y esta vez el SN confirma.
      await f.post('adjudicar', M, { ofertaIds: [a.id] }).expect(200);
      assert.equal((await f.estado()).compromiso.estado, 'PENDIENTE');
      const ok = (await f.callback('adjudicacion/resultado', { status: 201, body: JSON.stringify({
        emergenciaId: f.id, compromisos: [{ id: 77, loteId: l.id, externalId: A, estado: 'ACTIVO', repetido: false }] }) }).expect(200)).body.data;
      assert.equal(ok.compromisoOk, true);
      f.stub.compromiso(f.caseId, true);
      const adj = await prisma.adjudicacion.findFirstOrThrow({ where: { oferta_id: a.id } });
      assert.equal(adj.sn_compromiso_id, 77);
      const conf = await f.estado();
      assert.equal(conf.compromiso.estado, 'CONFIRMADO');
      assert.ok(conf.readyTasks.some((t: { name: string }) => t.name === 'Monitorear despliegue'));
      // Reintento tardío del conector: no duplica la adjudicación.
      assert.equal((await f.callback('adjudicacion/resultado', { status: 201, body: '{}' }).expect(200)).body.data.compromisoOk, true);
      assert.equal(await prisma.adjudicacion.count({ where: { oferta_id: a.id } }), 1);
    } finally { await f.stub.close(); }
  });

  it('cierre: el operativo se cierra cuando Bonita informa la liberación; si el SN falla el conector falla', async () => {
    const f = await fixture();
    try {
      const { a } = await validada(f, 10);
      await f.post('ver-ofertas', M).expect(200);
      await f.post('adjudicar', M, { ofertaIds: [a.id] }).expect(200);
      await f.callback('adjudicacion/resultado', { status: 201, body: '{"compromisos":[]}' }).expect(200);
      f.stub.compromiso(f.caseId, true);
      await f.post('leer', A).expect(200);
      await f.post('finalizar-monitoreo').expect(200);
      await f.post('finalizar-actividad', A).expect(200);
      assert.ok((await f.estado()).availableActions.includes('cerrar'));
      await f.post('cerrar').expect(200);
      assert.equal((await prisma.emergencia.findUniqueOrThrow({ where: { id: f.id } })).cerrada_at, null);

      const fallo = await f.callback('cierre/resultado', { status: 503, body: '{"error":"SN caído"}' }).expect(502);
      assert.equal(fallo.body.error.code, 'SN_LIBERACION_FALLO');
      assert.equal((await prisma.emergencia.findUniqueOrThrow({ where: { id: f.id } })).cerrada_at, null);
      await f.callback('cierre/resultado', { status: 200, body: '{"liberados":1}' }).expect(200);
      f.stub.liberacion(f.caseId);
      assert.ok((await prisma.emergencia.findUniqueOrThrow({ where: { id: f.id } })).cerrada_at);
      // 404 del SN (nada para liberar) también cierra, y repetir es idempotente.
      await f.callback('cierre/resultado', { status: 404 }).expect(200);
      const fin = await f.estado();
      assert.equal(fin.state, 'COMPLETED'); assert.equal(fin.localClosed, true);
    } finally { await f.stub.close(); }
  });

  it('los callbacks exigen el secreto del conector y el caso de la emergencia', async () => {
    const f = await fixture();
    try {
      await request(f.app).post(`/api/internal/bonita/emergencias/${f.id}/adjudicacion/compromisos`).send({ caseId: f.caseId }).expect(401);
      await f.callback('adjudicacion/compromisos', { caseId: '1' }).expect(403);
      await f.callback('adjudicacion/resultado', { status: 'x' }).expect(400);
      const sinSeleccion = await f.callback('adjudicacion/compromisos').expect(409);
      assert.equal(sinSeleccion.body.error.code, 'SELECTION_NOT_FOUND');
    } finally { await f.stub.close(); }
  });

  it('el catálogo de códigos es la copia local del catálogo nacional y rechaza códigos inexistentes', async () => {
    const f = await fixture();
    try {
      const catalogo = (await request(f.app).get('/api/inventario/codigos-sn').set('X-Dev-User-Id', A).expect(200)).body;
      assert.equal(catalogo.origen, 'LOCAL');
      assert.deepEqual(catalogo.data.map((t: { codigo: string }) => t.codigo),
        ['PARAMEDICO', 'RACION_ALIMENTO', 'AGUA_POTABLE', 'KIT_MEDICO', 'VEHICULO_RESCATE']);
      const rechazado = await request(f.app).post('/api/inventario').set('X-Dev-User-Id', A)
        .send({ tipo: 'PERSONAL', descripcion: 'Brigada ' + randomUUID(), cantidad: 4, unidad: 'personas', codigoSn: 'BOMBERO' }).expect(422);
      assert.equal(rechazado.body.error.code, 'CODIGO_SN_INVALIDO');
    } finally { await f.stub.close(); }
  });
});

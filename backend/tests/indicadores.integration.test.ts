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
import { buildCaseTimeline } from '../src/integrations/bonita/bonita.client.js';
import { resumirTimelines } from '../src/services/indicadores.service.js';
import { bonitaServer } from './helpers/bonita-server.js';
import { testDatabaseUrl } from './helpers/test-database.js';
import { seedUsuarios, MUNICIPIO_DEMO_ID as M, COORDINADOR_DEMO_ID as C, ONG_A_DEMO_ID as A, ONG_B_DEMO_ID as B, AUDITOR_DEMO_ID as U } from '../prisma/seed.js';

const dbUrl = testDatabaseUrl();
const prisma = createPrismaClient(dbUrl);
const options = { compatibleProcessIds: [], callbackSecret: '', validationMode: 'PENDIENTE' as const };
const owned: string[] = [];
const consorcios: string[] = [];
// Fechas fuera del rango de cualquier otra prueba: el filtro aísla los datos de este archivo.
const D = (iso: string) => new Date(iso);
const RANGO = 'desde=2001-03-01&hasta=2001-04-30';

before(async () => {
  await promisify(execFile)(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: dbUrl }, windowsHide: true,
  });
  await seedUsuarios(prisma);
  await prisma.emergencia.deleteMany({ where: { created_at: { gte: D('2001-01-01T00:00:00Z'), lt: D('2002-01-01T00:00:00Z') } } }).catch(() => {});
});
after(async () => {
  await prisma.oferta.deleteMany({ where: { lote: { emergencia_id: { in: owned } } } });
  await prisma.lote.deleteMany({ where: { emergencia_id: { in: owned } } });
  await prisma.emergencia.deleteMany({ where: { id: { in: owned } } });
  await prisma.consorcio.deleteMany({ where: { id: { in: consorcios } } });
  await prisma.$disconnect();
});

/** Emergencia cerrada: registrada 10/03, publicada +2 h, ventana de 24 h, adjudicada +1 h, cerrada 20/03. */
async function emergenciaCerrada(caseId?: bigint) {
  const e = await prisma.emergencia.create({ data: {
    creada_por_id: M, gravedad: 'ALTA', zona: 'Indicadores ' + randomUUID(), descripcion: 'Prueba de tablero',
    created_at: D('2001-03-10T10:00:00Z'), cerrada_at: D('2001-03-20T10:00:00Z'), bonita_instance_id: caseId ?? null,
  } });
  owned.push(e.id);
  const ronda = await prisma.ronda.create({ data: {
    emergencia_id: e.id, numero: 1, publicada_at: D('2001-03-10T12:00:00Z'),
    ofertas_vistas_at: D('2001-03-11T12:30:00Z'), seleccionada_at: D('2001-03-11T13:00:00Z'), monitoreo_finalizado_at: D('2001-03-19T10:00:00Z'),
  } });
  const ventana = await prisma.ventanaConvocatoria.create({ data: {
    ronda_id: ronda.id, actividad_id: 'ind-' + randomUUID(), abierta_at: D('2001-03-10T12:00:00Z'),
    vence_at: D('2001-03-11T12:00:00Z'), cerrada_at: D('2001-03-11T12:00:00Z'),
  } });
  const personal = await prisma.lote.create({ data: { emergencia_id: e.id, ronda_id: ronda.id, tipo: 'PERSONAL', descripcion: 'Paramédicos', cantidad_requerida: 10, unidad: 'personas' } });
  const recurso = await prisma.lote.create({ data: { emergencia_id: e.id, ronda_id: ronda.id, tipo: 'RECURSO', descripcion: 'Raciones', cantidad_requerida: 100, unidad: 'raciones' } });
  const consorcio = await prisma.consorcio.create({ data: { nombre: 'Consorcio ' + randomUUID(), creado_por_id: A } });
  consorcios.push(consorcio.id);
  const oferta = (lote_id: string, ong: string, cantidad: number, consorcio_id?: string) =>
    prisma.oferta.create({ data: { lote_id, ong_usuario_id: ong, cantidad_ofrecida: cantidad, consorcio_id } });
  const o1 = await oferta(personal.id, A, 6);
  const o2 = await oferta(recurso.id, B, 50, consorcio.id);
  const o3 = await oferta(recurso.id, A, 30);
  const noElegida = await oferta(recurso.id, B, 5);
  for (const o of [o1, o2, o3]) {
    await prisma.adjudicacion.create({ data: { oferta_id: o.id, municipio_id: M, created_at: D('2001-03-11T13:00:00Z') } });
  }
  for (const [o, resultado] of [[o1, 'COMPLETA'], [o2, 'COMPLETA'], [o3, 'PARCIAL'], [noElegida, 'SIN_CAPACIDAD']] as const) {
    await prisma.ofertaValidacion.create({ data: {
      ventana_id: ventana.id, oferta_id: o.id, resultado, cantidad_valida: resultado === 'SIN_CAPACIDAD' ? 0 : o.cantidad_ofrecida,
      disponible: 100, motivo: 'test',
    } });
  }
  return e;
}

describe('Indicadores: líneas de tiempo de Bonita', () => {
  it('usa el fin de la tarea anterior cuando Bonita solo archivó el estado final', () => {
    const t = buildCaseTimeline('7', { state: 'COMPLETED', start: D('2026-10-23T10:00:00'), end: D('2026-10-23T13:00:00') }, [
      { id: '1', sourceObjectId: '100', caseId: '7', name: 'Registrar emergencia', state: 'completed', reached_state_date: '2026-10-23 10:30:00.000', archivedDate: '2026-10-23 10:30:00.000' },
      { id: '2', sourceObjectId: '101', caseId: '7', name: 'Generar y publicar lotes', state: 'ready', reached_state_date: '2026-10-23 10:30:00.000', archivedDate: '2026-10-23 11:00:00.000' },
      { id: '3', sourceObjectId: '101', caseId: '7', name: 'Generar y publicar lotes', state: 'completed', reached_state_date: '2026-10-23 11:00:00.000', archivedDate: '2026-10-23 11:00:00.000' },
      { id: '4', sourceObjectId: '102', caseId: '7', name: 'Cargar o editar ofertas', state: 'aborted', reached_state_date: '2026-10-23 12:00:00.000', archivedDate: '2026-10-23 12:00:00.000' },
      { id: '5', sourceObjectId: '103', caseId: '7', name: 'Monitorear despliegue', state: 'ready', reached_state_date: '2026-10-23 12:00:01.000' },
    ]);
    assert.deepEqual(t.tasks.map(x => [x.name, x.state, (new Date(x.end).getTime() - new Date(x.start).getTime()) / 60000]), [
      ['Registrar emergencia', 'completed', 30],
      ['Generar y publicar lotes', 'completed', 30],
      ['Cargar o editar ofertas', 'aborted', 60],
    ]);
    const resumen = resumirTimelines([t]);
    assert.equal(resumen.casosFinalizados, 1);
    assert.equal(resumen.duracionCasoPromedioMs, 3 * 3600000);
    assert.deepEqual(resumen.etapas.map(e => e.etapa), ['Registrar emergencia', 'Generar y publicar lotes', 'Cargar o editar ofertas']);
  });
});

describe('Indicadores: GET /api/indicadores', () => {
  it('exige rol AUDITOR y filtros válidos', async () => {
    const app = createApp(prisma, createBonitaService(), options);
    await request(app).get('/api/indicadores').expect(401);
    for (const actor of [M, C, A]) await request(app).get('/api/indicadores').set('X-Dev-User-Id', actor).expect(403);
    await request(app).get('/api/indicadores?desde=2001-05-01&hasta=2001-04-01').set('X-Dev-User-Id', U).expect(400);
    await request(app).get('/api/indicadores?gravedad=EXTREMA').set('X-Dev-User-Id', U).expect(400);
  });

  it('combina suministros, consorcios, estados, validaciones y tiempos locales', async () => {
    await emergenciaCerrada();
    const abierta = await prisma.emergencia.create({ data: {
      creada_por_id: M, gravedad: 'CRITICA', zona: 'Indicadores ' + randomUUID(), descripcion: 'Sin lotes', created_at: D('2001-04-02T10:00:00Z'),
    } });
    owned.push(abierta.id);
    const app = createApp(prisma, createBonitaService(), options);
    const { body } = await request(app).get('/api/indicadores?' + RANGO).set('X-Dev-User-Id', U).expect(200);
    const d = body.data;
    assert.equal(d.resumen.emergencias, 2);
    assert.equal(d.resumen.finalizadas, 1);
    assert.equal(d.resumen.suministrosMovilizados, 86);
    assert.equal(d.resumen.adjudicaciones, 3);
    assert.equal(d.resumen.adjudicacionesConsorcio, 1);
    assert.equal(d.resumen.porcentajeConsorcio, 0.3333);
    // Lote personal 6/10 y lote de raciones 80/100.
    assert.equal(d.resumen.coberturaPromedio, 0.7);
    assert.equal(d.resumen.duracionPromedioMs, 10 * 86400000);
    assert.deepEqual(d.suministrosPorMes, [{ mes: '2001-03', personal: 6, recurso: 80 }]);
    assert.deepEqual(Object.fromEntries(d.estados.map((e: { estado: string; cantidad: number }) => [e.estado, e.cantidad])),
      { REGISTRADA: 1, CONVOCATORIA: 0, EVALUACION: 0, EJECUCION: 0, FINALIZADA: 1 });
    assert.deepEqual(Object.fromEntries(d.validaciones.map((v: { resultado: string; cantidad: number }) => [v.resultado, v.cantidad])),
      { COMPLETA: 2, PARCIAL: 1, APOYO: 0, SIN_CAPACIDAD: 1 });
    assert.deepEqual(d.tiemposLocales.map((t: { etapa: string; promedioMs: number }) => [t.etapa, t.promedioMs / 3600000]), [
      ['Registro → publicación de lotes', 2],
      ['Convocatoria abierta', 24],
      ['Validación y adjudicación', 1],
      ['Ejecución y cierre', 213],
      ['Operativo completo', 240],
    ]);
    assert.equal(d.ongs[0].cantidad, 50);
    assert.equal(d.bonita.disponible, false);
    assert.match(d.bonita.motivo, /BONITA_ENABLED/);
    const filtrado = await request(app).get('/api/indicadores?' + RANGO + '&gravedad=CRITICA').set('X-Dev-User-Id', U).expect(200);
    assert.equal(filtrado.body.data.resumen.emergencias, 1);
    assert.equal(filtrado.body.data.emergencias[0].estado, 'REGISTRADA');
  });

  it('lee de la API de Bonita los tiempos por tarea con las sesiones de los tres actores', async () => {
    const stub = await bonitaServer();
    try {
      const caseId = 9_100_000_000_000n + BigInt(Date.now() % 1_000_000);
      stub.cases.set(String(caseId), { processId: '1', completed: true, recipients: [], start: '2001-03-10 10:00:00.000', end: '2001-03-10 16:00:00.000' });
      const archivo = (id: string, name: string, state: string, reached: string, archived: string) =>
        stub.archivedTasks.push({ id, sourceObjectId: 's' + id, caseId: String(caseId), name, state, assigned_id: '0',
          reached_state_date: reached, archivedDate: archived } as never);
      archivo('900001', 'Registrar emergencia', 'completed', '2001-03-10 10:00:00.000', '2001-03-10 11:00:00.000');
      archivo('900002', 'Generar y publicar lotes', 'completed', '2001-03-10 13:00:00.000', '2001-03-10 13:00:00.000');
      await emergenciaCerrada(caseId);
      const app = createApp(prisma, createBonitaService(stub.config), options);
      const { body } = await request(app).get('/api/indicadores?' + RANGO).set('X-Dev-User-Id', U).expect(200);
      const b = body.data.bonita;
      assert.equal(b.disponible, true);
      assert.equal(b.casosConsultados, 1);
      assert.equal(b.casosFinalizados, 1);
      assert.equal(b.duracionCasoPromedioMs, 6 * 3600000);
      assert.deepEqual(b.etapas.map((e: { etapa: string; promedioMs: number }) => [e.etapa, e.promedioMs / 3600000]),
        [['Registrar emergencia', 1], ['Generar y publicar lotes', 2]]);
      const usuarios = new Set(stub.requests.filter(r => r.path === '/bonita/loginservice').map(r => new URLSearchParams(r.body).get('username')));
      assert.deepEqual([...usuarios].sort(), ['rs.coordinador', 'rs.municipio', 'rs.ong']);
      assert.deepEqual(stub.failures, []);
    } finally { await stub.close(); }
  });

  it('informa Bonita no disponible sin perder los indicadores locales', async () => {
    const stub = await bonitaServer({ loginStatus: 401 });
    try {
      await emergenciaCerrada(9_200_000_000_000n + BigInt(Date.now() % 1_000_000));
      const app = createApp(prisma, createBonitaService(stub.config), options);
      const { body } = await request(app).get('/api/indicadores?' + RANGO).set('X-Dev-User-Id', U).expect(200);
      assert.equal(body.data.bonita.disponible, false);
      assert.match(body.data.bonita.motivo, /BONITA_AUTH_FAILED/);
      assert.ok(body.data.resumen.emergencias >= 1);
    } finally { await stub.close(); }
  });
});

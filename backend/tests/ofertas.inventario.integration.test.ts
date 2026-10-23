import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPrismaClient } from '../src/database/prisma.js';
import { testDatabaseUrl } from './helpers/test-database.js';
import {
  COORDINADOR_DEMO_ID,
  MUNICIPIO_DEMO_ID,
  ONG_A_DEMO_ID,
  ONG_B_DEMO_ID,
  seedUsuarios,
} from '../prisma/seed.js';

const dbUrl = testDatabaseUrl();
const prisma = createPrismaClient(dbUrl);
const app = createApp(prisma);
const root = fileURLToPath(new URL('../', import.meta.url));
const emergencias: string[] = [];
const items: string[] = [];

before(async () => {
  await promisify(execFile)(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: dbUrl },
    windowsHide: true,
  });
  await seedUsuarios(prisma);
});

after(async () => {
  try {
    await prisma.oferta.deleteMany({ where: { lote: { emergencia_id: { in: emergencias } } } });
    await prisma.inventarioItem.deleteMany({ where: { id: { in: items } } });
    await prisma.lote.deleteMany({ where: { emergencia_id: { in: emergencias } } });
    await prisma.emergencia.deleteMany({ where: { id: { in: emergencias } } });
  } finally {
    await prisma.$disconnect();
  }
});

type Codigo = 'PARAMEDICO' | 'RACION_ALIMENTO' | 'AGUA_POTABLE' | 'KIT_MEDICO' | 'VEHICULO_RESCATE';

async function item(ong: string, tipo: 'RECURSO' | 'PERSONAL', codigo_sn: Codigo | null, cantidad = 100) {
  const created = await prisma.inventarioItem.create({
    data: { ong_usuario_id: ong, tipo, descripcion: 'Item ' + randomUUID(), cantidad, unidad: 'u', codigo_sn },
  });
  items.push(created.id);
  return created;
}

/** Emergencia publicada con ventana abierta y un lote RECURSO + uno PERSONAL. */
async function escenario() {
  const created = await request(app).post('/api/emergencias').set('X-Dev-User-Id', MUNICIPIO_DEMO_ID)
    .send({ creada_por_id: MUNICIPIO_DEMO_ID, gravedad: 'ALTA', zona: 'Inventario ' + randomUUID(), descripcion: 'Reglas de oferta' }).expect(201);
  const id = created.body.data.id as string;
  emergencias.push(id);
  const crearLote = async (tipo: 'RECURSO' | 'PERSONAL', descripcion: string) => (await request(app)
    .post(`/api/emergencias/${id}/lotes`).set('X-Dev-User-Id', COORDINADOR_DEMO_ID)
    .send({ tipo, descripcion, cantidad_requerida: 100, unidad: 'u' }).expect(201)).body.data as { id: string };
  const recurso = await crearLote('RECURSO', 'Agua');
  const personal = await crearLote('PERSONAL', 'Paramédicos');
  await request(app).post(`/api/emergencias/${id}/acciones/publicar`).set('X-Dev-User-Id', COORDINADOR_DEMO_ID)
    .send({ accionId: randomUUID() }).expect(200);
  const ronda = await prisma.ronda.findFirstOrThrow({ where: { emergencia_id: id } });
  await prisma.ventanaConvocatoria.create({
    data: { ronda_id: ronda.id, actividad_id: 'inv-' + randomUUID().slice(0, 8), vence_at: new Date(Date.now() + 3_600_000) },
  });
  const ofertar = (loteId: string, body: object, actor = ONG_A_DEMO_ID) => request(app).post(`/api/lotes/${loteId}/ofertas`)
    .set('X-Dev-User-Id', actor).send({ ong_usuario_id: actor, ...body });
  return { id, recurso, personal, ofertar };
}

const codigo = (res: request.Response) => res.body.error?.code;

describe('Oferta ⇒ ítem de inventario con código del Sistema Nacional', () => {
  it('rechaza ofertas sin ítem o con ítem inválido, sin código, de otro tipo o de otra ONG', async () => {
    const { recurso, ofertar } = await escenario();

    const sinItem = await ofertar(recurso.id, { cantidad_ofrecida: 5 }).expect(400);
    assert.equal(codigo(sinItem), 'VALIDATION_ERROR');
    assert.ok(JSON.stringify(sinItem.body.error.details).includes('inventario_item_id'));
    await ofertar(recurso.id, { cantidad_ofrecida: 5, inventario_item_id: null }).expect(400);

    const inexistente = await ofertar(recurso.id, { cantidad_ofrecida: 5, inventario_item_id: randomUUID() }).expect(422);
    assert.equal(codigo(inexistente), 'INVALID_INVENTARIO');

    const sinCodigo = await item(ONG_A_DEMO_ID, 'RECURSO', null);
    assert.equal(codigo(await ofertar(recurso.id, { cantidad_ofrecida: 5, inventario_item_id: sinCodigo.id }).expect(422)), 'CODIGO_SN_REQUERIDO');

    const personal = await item(ONG_A_DEMO_ID, 'PERSONAL', 'PARAMEDICO');
    assert.equal(codigo(await ofertar(recurso.id, { cantidad_ofrecida: 5, inventario_item_id: personal.id }).expect(422)), 'TIPO_INCOMPATIBLE');

    const ajeno = await item(ONG_B_DEMO_ID, 'RECURSO', 'AGUA_POTABLE');
    assert.equal(codigo(await ofertar(recurso.id, { cantidad_ofrecida: 5, inventario_item_id: ajeno.id }).expect(422)), 'INVALID_INVENTARIO');

    const corto = await item(ONG_A_DEMO_ID, 'RECURSO', 'AGUA_POTABLE', 10);
    assert.equal(codigo(await ofertar(recurso.id, { cantidad_ofrecida: 11, inventario_item_id: corto.id }).expect(422)), 'INSUFFICIENT_STOCK');

    assert.equal(await prisma.oferta.count({ where: { lote_id: recurso.id } }), 0);
  });

  it('acepta ítem coherente y permite ofertar el mismo stock en varios lotes (el SN arbitra la concurrencia)', async () => {
    const e1 = await escenario();
    const e2 = await escenario();
    const agua = await item(ONG_A_DEMO_ID, 'RECURSO', 'AGUA_POTABLE', 50);
    const paramedico = await item(ONG_A_DEMO_ID, 'PERSONAL', 'PARAMEDICO', 5);

    const uno = (await e1.ofertar(e1.recurso.id, { cantidad_ofrecida: 50, inventario_item_id: agua.id }).expect(201)).body.data;
    await e2.ofertar(e2.recurso.id, { cantidad_ofrecida: 50, inventario_item_id: agua.id }).expect(201);
    await e1.ofertar(e1.personal.id, { cantidad_ofrecida: 5, inventario_item_id: paramedico.id }).expect(201);
    assert.equal(uno.inventario_item_id, agua.id);
  });

  it('PATCH exige ítem a ofertas legadas y permite corregirlas', async () => {
    const { recurso, ofertar } = await escenario();
    const legada = await prisma.oferta.create({
      data: { lote_id: recurso.id, ong_usuario_id: ONG_A_DEMO_ID, cantidad_ofrecida: 5 },
    });
    const patch = (body: object) => request(app).patch(`/api/ofertas/${legada.id}`).set('X-Dev-User-Id', ONG_A_DEMO_ID).send(body);

    assert.equal(codigo(await patch({ cantidad_ofrecida: 6 }).expect(422)), 'INVENTARIO_REQUERIDO');

    const sinCodigo = await item(ONG_A_DEMO_ID, 'RECURSO', null);
    assert.equal(codigo(await patch({ cantidad_ofrecida: 6, inventario_item_id: sinCodigo.id }).expect(422)), 'CODIGO_SN_REQUERIDO');

    const bueno = await item(ONG_A_DEMO_ID, 'RECURSO', 'KIT_MEDICO', 20);
    const ok = (await patch({ cantidad_ofrecida: 6, inventario_item_id: bueno.id }).expect(200)).body.data;
    assert.equal(ok.inventario_item_id, bueno.id);
    assert.equal(ok.cantidad_ofrecida, 6);

    // Una vez vinculado, omitir el ítem conserva el actual.
    const conservado = (await patch({ cantidad_ofrecida: 7 }).expect(200)).body.data;
    assert.equal(conservado.inventario_item_id, bueno.id);
  });
});

describe('Inventario: código SN obligatorio y tomado del catálogo', () => {
  const crear = (body: object) => request(app).post('/api/inventario').set('X-Dev-User-Id', ONG_A_DEMO_ID)
    .send({ descripcion: 'Stock ' + randomUUID(), cantidad: 10, unidad: 'u', ...body });
  const patch = (id: string, body: object) => request(app).patch(`/api/inventario/${id}`).set('X-Dev-User-Id', ONG_A_DEMO_ID).send(body);

  it('sin SN configurado ofrece el catálogo local y lo marca como LOCAL', async () => {
    const res = await request(app).get('/api/inventario/codigos-sn').set('X-Dev-User-Id', ONG_A_DEMO_ID).expect(200);
    assert.equal(res.body.origen, 'LOCAL');
    assert.deepEqual(res.body.data.map((t: { codigo: string }) => t.codigo).sort(),
      ['AGUA_POTABLE', 'KIT_MEDICO', 'PARAMEDICO', 'RACION_ALIMENTO', 'VEHICULO_RESCATE']);
    await request(app).get('/api/inventario/codigos-sn').set('X-Dev-User-Id', MUNICIPIO_DEMO_ID).expect(403);
  });

  it('rechaza crear sin código, con formato inválido o fuera del catálogo', async () => {
    assert.equal(codigo(await crear({ tipo: 'RECURSO' }).expect(400)), 'VALIDATION_ERROR');
    assert.equal(codigo(await crear({ tipo: 'RECURSO', codigoSn: null }).expect(400)), 'VALIDATION_ERROR');
    assert.equal(codigo(await crear({ tipo: 'RECURSO', codigoSn: 'agua potable' }).expect(400)), 'VALIDATION_ERROR');
    assert.equal(codigo(await crear({ tipo: 'RECURSO', codigoSn: 'NO_EXISTE' }).expect(422)), 'CODIGO_SN_INVALIDO');
  });

  it('la ONG elige cualquier código del catálogo para su ítem, sin atarlo al tipo', async () => {
    const personal = (await crear({ tipo: 'PERSONAL', codigoSn: 'KIT_MEDICO' }).expect(201)).body.data;
    items.push(personal.id);
    assert.equal(personal.codigo_sn, 'KIT_MEDICO');
    const recurso = (await crear({ tipo: 'RECURSO', codigoSn: 'PARAMEDICO' }).expect(201)).body.data;
    items.push(recurso.id);

    assert.equal((await patch(recurso.id, { codigoSn: 'AGUA_POTABLE' }).expect(200)).body.data.codigo_sn, 'AGUA_POTABLE');
    assert.equal(codigo(await patch(recurso.id, { codigoSn: 'NO_EXISTE' }).expect(422)), 'CODIGO_SN_INVALIDO');
    assert.equal((await patch(recurso.id, { tipo: 'PERSONAL' }).expect(200)).body.data.tipo, 'PERSONAL');
  });
});

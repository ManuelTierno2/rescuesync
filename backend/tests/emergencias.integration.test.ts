import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createApp } from '../src/app.js';
import { databaseUrlSchema } from '../src/config/env.js';
import { createPrismaClient } from '../src/database/prisma.js';
import { MUNICIPIO_DEMO_ID, seedMunicipio } from '../prisma/seed.js';

const testUrl = databaseUrlSchema.safeParse(process.env.TEST_DATABASE_URL);
if (!testUrl.success) {
  throw new Error('Configurar TEST_DATABASE_URL con una base PostgreSQL exclusiva para pruebas.');
}
const databaseName = decodeURIComponent(new URL(testUrl.data).pathname.slice(1));
const appUrl = databaseUrlSchema.safeParse(process.env.DATABASE_URL);
if (!databaseName.endsWith('_test') ||
    (appUrl.success && decodeURIComponent(new URL(appUrl.data).pathname.slice(1)) === databaseName)) {
  throw new Error('La base de pruebas debe terminar en _test y ser distinta de DATABASE_URL.');
}

const prisma = createPrismaClient(testUrl.data);
const app = createApp(prisma);
const root = fileURLToPath(new URL('../', import.meta.url));
const owned = { emergencias: [] as string[], lotes: [] as string[], ofertas: [] as string[], usuarios: [] as string[] };
const otrosRoles = new Map<string, string>();
const validBody = {
  creada_por_id: MUNICIPIO_DEMO_ID,
  gravedad: 'ALTA',
  zona: 'Barrio Centro',
  descripcion: 'Inundación con viviendas afectadas.',
};

async function createEmergency() {
  const response = await request(app).post('/api/emergencias').send(validBody).expect(201);
  owned.emergencias.push(response.body.data.id);
  return response;
}

function assertError(response: request.Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.match(response.headers['content-type'] ?? '', /application\/json/);
  assert.deepEqual(Object.keys(response.body), ['error']);
  assert.deepEqual(Object.keys(response.body.error).sort(), ['code', 'details', 'message']);
  assert.equal(response.body.error.code, code);
  assert.equal(typeof response.body.error.message, 'string');
  assert.ok(Array.isArray(response.body.error.details));
}

before(async () => {
  await promisify(execFile)(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: testUrl.data },
    windowsHide: true,
  });
  await prisma.$connect();
  await seedMunicipio(prisma);
  for (const rol of ['COORDINADOR', 'ONG', 'AUDITOR'] as const) {
    const id = randomUUID();
    await prisma.usuario.create({
      data: { id, nombre: `Prueba ${rol}`, email: `${id}@rescuesync.test`, rol, organizacion: 'Pruebas' },
    });
    owned.usuarios.push(id);
    otrosRoles.set(rol, id);
  }
});

after(async () => {
  try {
    // Borrar únicamente los registros creados por esta ejecución.
    await prisma.oferta.deleteMany({ where: { id: { in: owned.ofertas } } });
    await prisma.lote.deleteMany({ where: { id: { in: owned.lotes } } });
    await prisma.emergencia.deleteMany({ where: { id: { in: owned.emergencias } } });
    await prisma.usuario.deleteMany({ where: { id: { in: owned.usuarios } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe('Emergencias y persistencia PostgreSQL', () => {
  it('permite repetir el seed sin duplicar al usuario municipal', async () => {
    await seedMunicipio(prisma);
    await seedMunicipio(prisma);
    assert.equal(await prisma.usuario.count({ where: { id: MUNICIPIO_DEMO_ID } }), 1);
    assert.equal(await prisma.usuario.count({ where: { email: 'municipio@rescuesync.test' } }), 1);
  });

  it('crea, persiste y recupera una emergencia sin relaciones expandidas', async () => {
    const created = await createEmergency();
    const data = created.body.data;
    assert.equal(created.headers.location, `/api/emergencias/${data.id}`);
    assert.equal(data.bonita_instance_id, null);
    assert.equal(data.creada_por_id, MUNICIPIO_DEMO_ID);
    assert.ok(!Number.isNaN(Date.parse(data.created_at)));
    assert.ok(!Number.isNaN(Date.parse(data.updated_at)));
    assert.deepEqual(Object.keys(data).sort(), [
      'id', 'creada_por_id', 'gravedad', 'zona', 'descripcion', 'bonita_instance_id', 'created_at', 'updated_at',
    ].sort());
    const saved = await prisma.emergencia.findUniqueOrThrow({ where: { id: data.id } });
    assert.equal(saved.descripcion, validBody.descripcion);
    const fetched = await request(app).get(created.headers.location!).expect(200);
    assert.deepEqual(fetched.body, created.body);
  });

  it('normaliza espacios y admite las cuatro gravedades y los largos máximos', async () => {
    for (const gravedad of ['BAJA', 'MEDIA', 'ALTA', 'CRITICA']) {
      const zona = gravedad === 'CRITICA' ? 'z'.repeat(200) : 'Centro';
      const descripcion = gravedad === 'CRITICA' ? 'd'.repeat(5000) : 'Descripción';
      const response = await request(app).post('/api/emergencias')
        .send({ ...validBody, gravedad, zona: ` ${zona} `, descripcion: ` ${descripcion} ` }).expect(201);
      owned.emergencias.push(response.body.data.id);
      assert.equal(response.body.data.zona, zona);
      assert.equal(response.body.data.descripcion, descripcion);
      assert.equal(response.body.data.gravedad, gravedad);
    }
  });

  it('serializa un identificador Bonita grande como string y preserva su unicidad', async () => {
    const first = await createEmergency();
    const second = await createEmergency();
    const bonitaId = 9223372036854775807n;
    await prisma.emergencia.update({ where: { id: first.body.data.id }, data: { bonita_instance_id: bonitaId } });
    const response = await request(app).get(first.headers.location!).expect(200);
    assert.equal(response.body.data.bonita_instance_id, bonitaId.toString());
    await assert.rejects(prisma.emergencia.update({
      where: { id: second.body.data.id }, data: { bonita_instance_id: bonitaId },
    }), { code: 'P2002' });
  });

  it('rechaza datos inválidos y propiedades administradas sin insertar filas', async () => {
    const count = await prisma.emergencia.count();
    const bodies: unknown[] = [
      {}, [], null,
      { ...validBody, creada_por_id: 'incorrecto' },
      { ...validBody, gravedad: 'URGENTE' },
      { ...validBody, gravedad: 2 },
      { ...validBody, zona: '   ' },
      { ...validBody, zona: 42 },
      { ...validBody, zona: 'z'.repeat(201) },
      { ...validBody, descripcion: '  ' },
      { ...validBody, descripcion: 'd'.repeat(5001) },
      { ...validBody, descripcion: null },
      { ...validBody, id: randomUUID() },
      { ...validBody, bonita_instance_id: null },
      { ...validBody, created_at: new Date().toISOString() },
      { ...validBody, updated_at: new Date().toISOString() },
      { ...validBody, desconocido: true },
    ];
    for (const body of bodies) {
      const response = await request(app).post('/api/emergencias').set('Content-Type', 'application/json')
        .send(JSON.stringify(body));
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.ok(['VALIDATION_ERROR', 'INVALID_JSON'].includes(response.body.error.code));
      assert.ok(Array.isArray(response.body.error.details));
    }
    assert.equal(await prisma.emergencia.count(), count);
  });

  it('rechaza JSON mal formado, cuerpo ausente, texto plano y cuerpos demasiado grandes', async () => {
    assertError(await request(app).post('/api/emergencias').type('json').send('{'), 400, 'INVALID_JSON');
    assertError(await request(app).post('/api/emergencias'), 400, 'VALIDATION_ERROR');
    assertError(await request(app).post('/api/emergencias').type('text').send('texto'), 400, 'VALIDATION_ERROR');
    assertError(await request(app).post('/api/emergencias').send({ ...validBody, descripcion: 'x'.repeat(110000) }),
      400, 'BODY_TOO_LARGE');
  });

  it('rechaza autores inexistentes y los tres roles no municipales', async () => {
    const count = await prisma.emergencia.count();
    for (const creada_por_id of [randomUUID(), ...otrosRoles.values()]) {
      assertError(await request(app).post('/api/emergencias').send({ ...validBody, creada_por_id }), 422, 'INVALID_CREATOR');
    }
    assert.equal(await prisma.emergencia.count(), count);
  });

  it('distingue ID inválido, emergencia inexistente y ruta inexistente', async () => {
    assertError(await request(app).get('/api/emergencias/no-es-uuid'), 400, 'VALIDATION_ERROR');
    assertError(await request(app).get('/api/emergencias/%E0%A4%A'), 400, 'INVALID_URL');
    assertError(await request(app).get(`/api/emergencias/${randomUUID()}`), 404, 'EMERGENCIA_NOT_FOUND');
    assertError(await request(app).get('/api/inexistente'), 404, 'ROUTE_NOT_FOUND');
  });

  it('persiste lotes y ofertas parciales, y exige cantidades positivas y referencias válidas', async () => {
    const emergency = await createEmergency();
    const loteData = {
      emergencia_id: emergency.body.data.id as string, tipo: 'PERSONAL' as const,
      descripcion: 'Paramédicos', cantidad_requerida: 5, unidad: 'personas',
    };
    const lote = await prisma.lote.create({ data: loteData });
    owned.lotes.push(lote.id);
    const ofertaData = { lote_id: lote.id, ong_usuario_id: otrosRoles.get('ONG')!, cantidad_ofrecida: 2 };
    const oferta = await prisma.oferta.create({ data: ofertaData });
    owned.ofertas.push(oferta.id);
    assert.equal(oferta.cantidad_ofrecida, 2);

    for (const cantidad of [0, -1]) {
      await assert.rejects(prisma.lote.create({ data: { ...loteData, cantidad_requerida: cantidad } }), /lotes_cantidad_positiva/);
      await assert.rejects(prisma.oferta.create({ data: { ...ofertaData, cantidad_ofrecida: cantidad } }), /ofertas_cantidad_positiva/);
    }
    await assert.rejects(prisma.emergencia.create({ data: { ...validBody, gravedad: 'ALTA', creada_por_id: randomUUID() } }), { code: 'P2003' });
    await assert.rejects(prisma.lote.create({ data: { ...loteData, emergencia_id: randomUUID() } }), { code: 'P2003' });
    await assert.rejects(prisma.oferta.create({ data: { ...ofertaData, lote_id: randomUUID() } }), { code: 'P2003' });
    await assert.rejects(prisma.oferta.create({ data: { ...ofertaData, ong_usuario_id: randomUUID() } }), { code: 'P2003' });
  });

  it('responde 500 sin filtrar detalles internos cuando falla una operación', async () => {
    const misconfiguredPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testUrl.data }, {
        schema: `missing_${randomUUID().replaceAll('-', '')}`,
      }),
    });
    try {
      const response = await request(createApp(misconfiguredPrisma)).get(`/api/emergencias/${randomUUID()}`);
      assertError(response, 500, 'INTERNAL_ERROR');
      assert.doesNotMatch(response.text, /SELECT|password|stack|postgresql|missing_|P2021/);
    } finally {
      await misconfiguredPrisma.$disconnect();
    }
  });

  it('responde 503 cuando PostgreSQL no está disponible', async () => {
    const portReservation = createServer();
    await new Promise<void>((resolve) => portReservation.listen(0, '127.0.0.1', resolve));
    const address = portReservation.address();
    assert.ok(address && typeof address !== 'string');
    const unavailableUrl = new URL(testUrl.data);
    unavailableUrl.hostname = '127.0.0.1';
    unavailableUrl.port = String(address.port);
    await new Promise<void>((resolve, reject) => portReservation.close((error) => error ? reject(error) : resolve()));
    const disconnectedPrisma = createPrismaClient(unavailableUrl.toString());
    try {
      const response = await request(createApp(disconnectedPrisma)).get(`/api/emergencias/${randomUUID()}`);
      assertError(response, 503, 'DATABASE_UNAVAILABLE');
      assert.doesNotMatch(response.text, /ECONNREFUSED|postgresql|SELECT|stack/);
    } finally {
      await disconnectedPrisma.$disconnect();
    }
  });
});

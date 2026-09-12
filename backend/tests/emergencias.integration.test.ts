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
import { testDatabaseUrl } from './helpers/test-database.js';
import { createPrismaClient } from '../src/database/prisma.js';
import { MUNICIPIO_DEMO_ID, ONG_B_DEMO_ID, seedMunicipio, seedUsuarios } from '../prisma/seed.js';
import { createBonitaService } from '../src/integrations/bonita/bonita.service.js';
import { bonitaServer } from './helpers/bonita-server.js';

const testUrl = { data: testDatabaseUrl() };

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
  await seedUsuarios(prisma);
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

describe('Etapa 2: usuarios, lotes y ofertas por HTTP', () => {
  async function lote(emergenciaId: string, changes = {}) {
    const response = await request(app).post('/api/emergencias/' + emergenciaId + '/lotes').send({
      tipo: 'RECURSO', descripcion: 'Raciones de alimento', cantidad_requerida: 1000, unidad: 'raciones', ...changes,
    }).expect(201);
    owned.lotes.push(response.body.data.id);
    return response.body.data;
  }
  it('lista los cuatro roles con datos públicos y el seed es repetible sin sobrescribir', async () => {
    const before = await seedUsuarios(prisma);
    const afterSeed = await seedUsuarios(prisma);
    assert.deepEqual(afterSeed, before);
    const response = await request(app).get('/api/usuarios').expect(200);
    assert.deepEqual(new Set(response.body.data.map((u: { rol: string }) => u.rol)), new Set(['MUNICIPIO', 'COORDINADOR', 'ONG', 'AUDITOR']));
    for (const user of response.body.data) assert.deepEqual(Object.keys(user).sort(), ['id', 'nombre', 'organizacion', 'rol']);
  });
  it('lista emergencias persistidas con IDs Bonita como string', async () => {
    const created = await createEmergency();
    await prisma.emergencia.update({ where: { id: created.body.data.id }, data: { bonita_instance_id: 9007199254740993n } });
    const response = await request(app).get('/api/emergencias').expect(200);
    const entry = response.body.data.find((e: { id: string }) => e.id === created.body.data.id);
    assert.equal(entry.bonita_instance_id, '9007199254740993');
    const dates = response.body.data.map((e: { created_at: string }) => Date.parse(e.created_at));
    assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
  });
  it('crea raciones y personal, registra ofertas parciales de distintas ONG y conserva todo en PostgreSQL', async () => {
    const created = await createEmergency();
    const id = created.body.data.id;
    assert.deepEqual((await request(app).get('/api/emergencias/' + id + '/lotes').expect(200)).body, { data: [] });
    const raciones = await lote(id);
    const personal = await lote(id, { tipo: 'PERSONAL', descripcion: 'Paramédicos', cantidad_requerida: 5, unidad: 'personas' });
    assert.deepEqual((await request(app).get('/api/lotes/' + raciones.id + '/ofertas').expect(200)).body, { data: [] });
    for (const [loteId, ong, cantidad] of [
      [raciones.id, otrosRoles.get('ONG')!, 400], [raciones.id, ONG_B_DEMO_ID, 300],
      [raciones.id, ONG_B_DEMO_ID, 1400], [personal.id, otrosRoles.get('ONG')!, 2],
    ] as const) {
      const response = await request(app).post('/api/lotes/' + loteId + '/ofertas').send({
        ong_usuario_id: ong, cantidad_ofrecida: cantidad, observaciones: '  Entrega inmediata  ',
      }).expect(201);
      owned.ofertas.push(response.body.data.id);
      assert.equal(response.body.data.observaciones, 'Entrega inmediata');
      assert.equal(response.body.data.ong_usuario.rol, 'ONG');
      assert.equal((await prisma.oferta.findUniqueOrThrow({ where: { id: response.body.data.id } })).cantidad_ofrecida, cantidad);
    }
    const listed = await request(app).get('/api/emergencias/' + id + '/lotes').expect(200);
    assert.deepEqual(listed.body.data.map((l: { id: string }) => l.id), [raciones.id, personal.id]);
    const ofertas = await request(app).get('/api/lotes/' + raciones.id + '/ofertas').expect(200);
    assert.deepEqual(ofertas.body.data.map((o: { cantidad_ofrecida: number }) => o.cantidad_ofrecida), [400, 300, 1400]);
  });
  it('normaliza textos y acepta límites y observaciones vacías', async () => {
    const created = await createEmergency();
    const item = await lote(created.body.data.id, { descripcion: ' ' + 'd'.repeat(5000) + ' ', unidad: ' ' + 'u'.repeat(50) + ' ', cantidad_requerida: 2147483647 });
    assert.equal(item.descripcion.length, 5000);
    assert.equal(item.unidad.length, 50);
    for (const observaciones of [undefined, null, '  ', 'o'.repeat(5000)]) {
      const response = await request(app).post('/api/lotes/' + item.id + '/ofertas').send({
        ong_usuario_id: otrosRoles.get('ONG'), cantidad_ofrecida: 2147483647, observaciones,
      }).expect(201);
      owned.ofertas.push(response.body.data.id);
      assert.equal(response.body.data.observaciones, typeof observaciones === 'string' && observaciones.trim() ? observaciones : null);
    }
  });
  it('rechaza cuerpos inválidos sin insertar lotes ni ofertas', async () => {
    const created = await createEmergency();
    const item = await lote(created.body.data.id);
    const loteBody = { tipo: 'RECURSO', descripcion: 'Alimentos', cantidad_requerida: 1000, unidad: 'raciones' };
    const ofertaBody = { ong_usuario_id: otrosRoles.get('ONG'), cantidad_ofrecida: 400 };
    const lotesCount = await prisma.lote.count();
    const ofertasCount = await prisma.oferta.count();
    for (const cantidad of [0, -1, 1.5, 2147483648, '2', null]) {
      assertError(await request(app).post('/api/emergencias/' + created.body.data.id + '/lotes').send({ ...loteBody, cantidad_requerida: cantidad }), 400, 'VALIDATION_ERROR');
      assertError(await request(app).post('/api/lotes/' + item.id + '/ofertas').send({ ...ofertaBody, cantidad_ofrecida: cantidad }), 400, 'VALIDATION_ERROR');
    }
    for (const change of [
      { tipo: 'OTRO' }, { descripcion: ' ' }, { descripcion: 'd'.repeat(5001) }, { unidad: ' ' },
      { unidad: 'u'.repeat(51) }, { emergencia_id: randomUUID() }, { id: randomUUID() }, { created_at: 'now' },
    ]) assertError(await request(app).post('/api/emergencias/' + created.body.data.id + '/lotes').send({ ...loteBody, ...change }), 400, 'VALIDATION_ERROR');
    for (const change of [
      { ong_usuario_id: 'invalid' }, { observaciones: 42 }, { observaciones: 'o'.repeat(5001) },
      { lote_id: randomUUID() }, { id: randomUUID() }, { updated_at: 'now' },
    ]) assertError(await request(app).post('/api/lotes/' + item.id + '/ofertas').send({ ...ofertaBody, ...change }), 400, 'VALIDATION_ERROR');
    assert.equal(await prisma.lote.count(), lotesCount);
    assert.equal(await prisma.oferta.count(), ofertasCount);
  });
  it('comprueba existencia de padres y rol ONG en el backend', async () => {
    const created = await createEmergency();
    const item = await lote(created.body.data.id);
    const unknown = randomUUID();
    const loteBody = { tipo: 'RECURSO', descripcion: 'Alimentos', cantidad_requerida: 1, unidad: 'raciones' };
    const ofertaBody = { ong_usuario_id: otrosRoles.get('ONG'), cantidad_ofrecida: 1 };
    assertError(await request(app).get('/api/emergencias/' + unknown + '/lotes'), 404, 'EMERGENCIA_NOT_FOUND');
    assertError(await request(app).post('/api/emergencias/' + unknown + '/lotes').send(loteBody), 404, 'EMERGENCIA_NOT_FOUND');
    assertError(await request(app).get('/api/lotes/' + unknown + '/ofertas'), 404, 'LOTE_NOT_FOUND');
    assertError(await request(app).post('/api/lotes/' + unknown + '/ofertas').send(ofertaBody), 404, 'LOTE_NOT_FOUND');
    for (const path of ['/api/emergencias/invalid/lotes', '/api/lotes/invalid/ofertas']) {
      assertError(await request(app).get(path), 400, 'VALIDATION_ERROR');
      assertError(await request(app).post(path).send({}), 400, 'VALIDATION_ERROR');
    }
    for (const ong_usuario_id of [unknown, MUNICIPIO_DEMO_ID, otrosRoles.get('COORDINADOR'), otrosRoles.get('AUDITOR')]) {
      assertError(await request(app).post('/api/lotes/' + item.id + '/ofertas').send({ ...ofertaBody, ong_usuario_id }), 422, 'INVALID_ONG');
    }
    assert.equal(await prisma.oferta.count({ where: { lote_id: item.id } }), 0);
  });
  it('admite el origen local y preflight de JSON sin credenciales', async () => {
    const response = await request(app).options('/api/emergencias').set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type').expect(204);
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.match(response.headers['access-control-allow-methods']!, /POST/);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
    const other = await request(app).get('/api/usuarios').set('Origin', 'http://untrusted.test').expect(200);
    assert.notEqual(other.headers['access-control-allow-origin'], 'http://untrusted.test');
  });
});

describe('Alta de emergencia e integración Bonita con PostgreSQL', () => {
  for (const startStatus of [200, 201]) {
    it(`guarda antes de iniciar y persiste el caseId de HTTP ${startStatus} antes de responder`, async () => {
      const zona = 'Bonita ' + randomUUID();
      const caseId = startStatus === 200 ? '9223372036854775805' : '9223372036854775806';
      let persistedBeforeStart = false;
      const stub = await bonitaServer({ startStatus, startBody: JSON.stringify({ caseId }), onStart: async () => {
        const saved = await prisma.emergencia.findFirstOrThrow({ where: { zona } });
        owned.emergencias.push(saved.id);
        assert.equal(saved.bonita_instance_id, null);
        persistedBeforeStart = true;
      } });
      try {
        const response = await request(createApp(prisma, createBonitaService(stub.config))).post('/api/emergencias')
          .send({ ...validBody, zona }).expect(201);
        owned.emergencias.push(response.body.data.id);
        assert.ok(persistedBeforeStart);
        assert.deepEqual(stub.failures, []);
        assert.equal(response.body.data.bonita_instance_id, caseId);
        assert.equal(response.body.warnings, undefined);
        assert.equal((await prisma.emergencia.findUniqueOrThrow({ where: { id: response.body.data.id } })).bonita_instance_id, BigInt(caseId));
        assert.deepEqual((await request(app).get(response.headers.location!).expect(200)).body, response.body);
        assert.equal(stub.requests.filter((r) => r.path.endsWith('/instantiation')).length, 1);
      } finally { await stub.close(); }
    });
  }
  it('rechaza un alta inválida antes de contactar Bonita', async () => {
    const stub = await bonitaServer();
    try {
      assertError(await request(createApp(prisma, createBonitaService(stub.config))).post('/api/emergencias')
        .send({ ...validBody, creada_por_id: otrosRoles.get('ONG') }), 422, 'INVALID_CREATOR');
      assert.equal(stub.requests.length, 0);
    } finally { await stub.close(); }
  });
  it('devuelve 201 con la emergencia conservada cuando falla Bonita', async () => {
    const stub = await bonitaServer({ loginStatus: 401 });
    try {
      const response = await request(createApp(prisma, createBonitaService(stub.config))).post('/api/emergencias').send(validBody).expect(201);
      owned.emergencias.push(response.body.data.id);
      assert.equal(response.body.data.bonita_instance_id, null);
      assert.equal(response.body.warnings[0].code, 'BONITA_AUTH_FAILED');
      assert.equal((await request(app).get(response.headers.location!).expect(200)).body.data.id, response.body.data.id);
    } finally { await stub.close(); }
  });
  it('con Bonita detenido mantiene el alta y devuelve advertencia', async () => {
    const stub = await bonitaServer();
    await stub.close();
    const response = await request(createApp(prisma, createBonitaService(stub.config))).post('/api/emergencias').send(validBody).expect(201);
    owned.emergencias.push(response.body.data.id);
    assert.equal(response.body.warnings[0].code, 'BONITA_CONNECTION_FAILED');
    assert.equal((await prisma.emergencia.findUniqueOrThrow({ where: { id: response.body.data.id } })).bonita_instance_id, null);
  });
  it('conserva el registro y el ID conocido en la advertencia si falla el vínculo', async () => {
    const extended = prisma.$extends({ query: { emergencia: { async update() {
      throw new Error('sensitive SQL or credentials must not leak');
    } } } });
    const stub = await bonitaServer({ startBody: '{"caseId":"987654321"}' });
    try {
      const response = await request(createApp(extended as unknown as PrismaClient, createBonitaService(stub.config)))
        .post('/api/emergencias').send(validBody).expect(201);
      owned.emergencias.push(response.body.data.id);
      assert.equal(response.body.data.bonita_instance_id, null);
      assert.equal(response.body.warnings[0].code, 'BONITA_LINK_FAILED');
      assert.match(response.body.warnings[0].message, /987654321/);
      assert.doesNotMatch(response.text, /sensitive|SQL|credentials/);
      assert.equal(stub.requests.filter((r) => r.path.endsWith('/instantiation')).length, 1);
      assert.ok(await prisma.emergencia.findUnique({ where: { id: response.body.data.id } }));
    } finally { await stub.close(); }
  });
});

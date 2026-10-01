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
  seedUsuarios,
} from '../prisma/seed.js';

const dbUrl = testDatabaseUrl();
const prisma = createPrismaClient(dbUrl);
const app = createApp(prisma);
const root = fileURLToPath(new URL('../', import.meta.url));
const owned: string[] = [];

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
    await prisma.oferta.deleteMany({ where: { lote: { emergencia_id: { in: owned } } } });
    await prisma.lote.deleteMany({ where: { emergencia_id: { in: owned } } });
    await prisma.emergencia.deleteMany({ where: { id: { in: owned } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe('Ofertas versionado', () => {
  it('crea historial v1 y permite PATCH incrementando versión', async () => {
    const created = await request(app).post('/api/emergencias')
      .set('X-Dev-User-Id', MUNICIPIO_DEMO_ID)
      .send({
        creada_por_id: MUNICIPIO_DEMO_ID,
        gravedad: 'ALTA',
        zona: 'Versionado ' + randomUUID(),
        descripcion: 'Prueba de versiones de oferta',
      }).expect(201);
    const emergenciaId = created.body.data.id as string;
    owned.push(emergenciaId);

    const lote = await request(app).post(`/api/emergencias/${emergenciaId}/lotes`)
      .set('X-Dev-User-Id', COORDINADOR_DEMO_ID)
      .send({ tipo: 'RECURSO', descripcion: 'Agua', cantidad_requerida: 100, unidad: 'litros' })
      .expect(201);

    await request(app).post(`/api/emergencias/${emergenciaId}/acciones/publicar`)
      .set('X-Dev-User-Id', COORDINADOR_DEMO_ID)
      .send({ accionId: randomUUID() }).expect(200);

    // Abrir ventana manualmente (sin Bonita): crear ventana abierta
    const ronda = await prisma.ronda.findFirstOrThrow({ where: { emergencia_id: emergenciaId } });
    await prisma.ventanaConvocatoria.create({
      data: {
        ronda_id: ronda.id,
        actividad_id: 'test-actividad-' + randomUUID().slice(0, 8),
        vence_at: new Date(Date.now() + 3_600_000),
      },
    });

    const oferta = await request(app).post(`/api/lotes/${lote.body.data.id}/ofertas`)
      .set('X-Dev-User-Id', ONG_A_DEMO_ID)
      .send({
        ong_usuario_id: ONG_A_DEMO_ID,
        cantidad_ofrecida: 40,
        observaciones: 'Primera versión',
      }).expect(201);
    assert.equal(oferta.body.data.version, 1);

    const historial1 = await request(app).get(`/api/ofertas/${oferta.body.data.id}/historial`)
      .set('X-Dev-User-Id', ONG_A_DEMO_ID).expect(200);
    assert.equal(historial1.body.data.length, 1);
    assert.equal(historial1.body.data[0].version, 1);

    const patched = await request(app).patch(`/api/ofertas/${oferta.body.data.id}`)
      .set('X-Dev-User-Id', ONG_A_DEMO_ID)
      .send({ cantidad_ofrecida: 55, observaciones: 'Actualizada' }).expect(200);
    assert.equal(patched.body.data.version, 2);
    assert.equal(patched.body.data.cantidad_ofrecida, 55);

    const historial2 = await request(app).get(`/api/ofertas/${oferta.body.data.id}/historial`)
      .set('X-Dev-User-Id', ONG_A_DEMO_ID).expect(200);
    assert.equal(historial2.body.data.length, 2);
    assert.equal(historial2.body.data[1].version, 2);

    await prisma.ventanaConvocatoria.updateMany({
      where: { ronda_id: ronda.id },
      data: { cerrada_at: new Date() },
    });
    await request(app).patch(`/api/ofertas/${oferta.body.data.id}`)
      .set('X-Dev-User-Id', ONG_A_DEMO_ID)
      .send({ cantidad_ofrecida: 60, observaciones: 'Tarde' }).expect(409);
  });
});

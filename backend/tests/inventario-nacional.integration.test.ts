import 'dotenv/config';
import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPrismaClient } from '../src/database/prisma.js';
import { createBonitaService } from '../src/integrations/bonita/bonita.service.js';
import { createSnClient } from '../src/integrations/sistema-nacional/sn.client.js';
import { snServer, DISPONIBILIDAD, type SnStubOptions } from './helpers/sn-server.js';
import { testDatabaseUrl } from './helpers/test-database.js';
import { seedUsuarios, COORDINADOR_DEMO_ID as C, ONG_A_DEMO_ID as A, ONG_B_DEMO_ID as B } from '../prisma/seed.js';

const prisma = createPrismaClient(testDatabaseUrl());
const base = { compatibleProcessIds: [], callbackSecret: '', validationMode: 'PENDIENTE' as const };
const FICHA_A = {
  id: 7, externalId: A, nombre: 'ONG A', estado: 'HABILITADA',
  certificaciones: [{ codigo: 'PARAMEDICO_AVANZADO', nombre: 'Paramédico avanzado', tipoRecurso: 'PARAMEDICO', nivelRiesgoMax: 'CRITICO', vencimiento: null, vigente: true }],
  recursos: [{ tipoRecurso: 'PARAMEDICO', unidad: 'persona', total: 10, bloqueado: 6, disponible: 4 }],
};

before(async () => { await seedUsuarios(prisma); });
after(async () => { await prisma.$disconnect(); });

async function withSn(options: SnStubOptions, run: (app: ReturnType<typeof createApp>) => Promise<void>) {
  const stub = await snServer(options);
  try { await run(createApp(prisma, createBonitaService(), { ...base, sn: createSnClient(stub.config) })); }
  finally { await stub.close(); }
}

describe('GET /api/inventario/nacional', () => {
  it('sin Sistema Nacional configurado informa que no está conectado', async () => {
    const app = createApp(prisma, createBonitaService(), base);
    const { body } = await request(app).get('/api/inventario/nacional').set('X-Dev-User-Id', A).expect(200);
    assert.deepEqual(body.data, { conectado: false, ong: null, disponibilidad: [] });
  });

  it('devuelve la ficha nacional de la ONG logueada y la disponibilidad global', () => withSn({ ongs: { [A]: FICHA_A } }, async app => {
    const { body } = await request(app).get('/api/inventario/nacional').set('X-Dev-User-Id', A).expect(200);
    assert.equal(body.data.conectado, true);
    assert.equal(body.data.ong.estado, 'HABILITADA');
    assert.deepEqual(body.data.ong.recursos[0], { tipoRecurso: 'PARAMEDICO', unidad: 'persona', total: 10, bloqueado: 6, disponible: 4 });
    assert.deepEqual(body.data.disponibilidad, DISPONIBILIDAD);
    // Una ONG que todavía no ofertó no está en el SN.
    const otra = await request(app).get('/api/inventario/nacional').set('X-Dev-User-Id', B).expect(200);
    assert.equal(otra.body.data.ong, null);
    await request(app).get('/api/inventario/nacional').set('X-Dev-User-Id', C).expect(403);
  }));

  it('responde 502 si el Sistema Nacional no responde', () => withSn({ loginStatus: 401 }, async app => {
    const { body } = await request(app).get('/api/inventario/nacional').set('X-Dev-User-Id', A).expect(502);
    assert.equal(body.error.code, 'SN_NO_DISPONIBLE');
  }));
});

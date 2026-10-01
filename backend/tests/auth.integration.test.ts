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
import { DEMO_PASSWORD, MUNICIPIO_DEMO_ID, seedUsuarios } from '../prisma/seed.js';

const dbUrl = testDatabaseUrl();
const prisma = createPrismaClient(dbUrl);
const app = createApp(prisma);
const root = fileURLToPath(new URL('../', import.meta.url));
const ownedUsers: string[] = [];

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
    await prisma.usuario.deleteMany({ where: { id: { in: ownedUsers } } });
    await prisma.organizacion.deleteMany({ where: { usuarios: { none: {} }, nombre: { startsWith: 'Org Test ' } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe('Auth JWT', () => {
  it('login, me y register ONG', async () => {
    const login = await request(app).post('/api/auth/login').send({
      email: 'municipio@rescuesync.test',
      password: DEMO_PASSWORD,
    }).expect(200);
    assert.equal(login.body.data.user.id, MUNICIPIO_DEMO_ID);
    assert.equal(typeof login.body.data.token, 'string');

    const me = await request(app).get('/api/auth/me')
      .set('Authorization', 'Bearer ' + login.body.data.token).expect(200);
    assert.equal(me.body.data.email, 'municipio@rescuesync.test');
    assert.equal(me.body.data.rol, 'MUNICIPIO');

    const email = `ong.${randomUUID()}@rescuesync.test`;
    const registered = await request(app).post('/api/auth/register').send({
      nombre: 'Nueva ONG',
      email,
      password: 'password123',
      organizacion: 'Org Test ' + randomUUID().slice(0, 8),
    }).expect(201);
    ownedUsers.push(registered.body.data.user.id);
    assert.equal(registered.body.data.user.rol, 'ONG');
    assert.ok(registered.body.data.token);

    await request(app).post('/api/auth/login').send({
      email: 'municipio@rescuesync.test',
      password: 'wrong-password',
    }).expect(401);
  });

  it('rechaza /me sin token y acepta X-Dev-User-Id en tests', async () => {
    await request(app).get('/api/auth/me').expect(401);
    const me = await request(app).get('/api/auth/me')
      .set('X-Dev-User-Id', MUNICIPIO_DEMO_ID).expect(200);
    assert.equal(me.body.data.id, MUNICIPIO_DEMO_ID);
  });
});

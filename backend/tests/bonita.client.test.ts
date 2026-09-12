import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBonitaClient } from '../src/integrations/bonita/bonita.client.js';
import { createBonitaService } from '../src/integrations/bonita/bonita.service.js';
import { readEnv } from '../src/config/env.js';
import { bonitaServer, PROCESS_ID, type StubOptions } from './helpers/bonita-server.js';

describe('Bonita Community 2025.2: contrato REST oficial 1.0.6', () => {
  for (const startStatus of [200, 201]) {
    it(`acepta HTTP ${startStatus}: autentica, conserva sesión/CSRF, inicia con contrato vacío y cierra sesión`, async () => {
      const stub = await bonitaServer({ startStatus });
      try {
        assert.equal(await createBonitaClient(stub.config).startProcess(), '9223372036854775806');
        assert.deepEqual(stub.failures, []);
        assert.deepEqual(stub.requests.map((r) => [r.method, r.path]), [
          ['POST', '/bonita/loginservice'], ['GET', '/bonita/API/bpm/process/' + PROCESS_ID],
          ['POST', '/bonita/API/bpm/process/' + PROCESS_ID + '/instantiation'],
          ['GET', '/bonita/logoutservice?redirect=false'],
        ]);
        assert.deepEqual(Object.fromEntries(new URLSearchParams(stub.requests[0]!.body)), {
          username: stub.config.username, password: stub.config.password, redirect: 'false',
        });
        assert.equal(stub.requests[2]!.body, '{}');
        assert.match(stub.requests[2]!.cookie, /JSESSIONID=/);
        assert.ok(stub.requests[2]!.token);
      } finally { await stub.close(); }
    });
  }

  it('preserva también un caseId numérico superior a Number.MAX_SAFE_INTEGER', async () => {
    const stub = await bonitaServer({ startBody: '{"caseId":9223372036854775807}' });
    try { assert.equal(await createBonitaClient(stub.config).startProcess(), '9223372036854775807'); }
    finally { await stub.close(); }
  });

  it('mantiene sesiones independientes en inicios concurrentes', async () => {
    const stub = await bonitaServer();
    try {
      const client = createBonitaClient(stub.config);
      await Promise.all([client.startProcess(), client.startProcess()]);
      const starts = stub.requests.filter((r) => r.path.endsWith('/instantiation'));
      assert.equal(starts.length, 2);
      assert.notEqual(starts[0]!.token, starts[1]!.token);
      assert.notEqual(starts[0]!.cookie, starts[1]!.cookie);
    } finally { await stub.close(); }
  });

  const scenarios: [string, StubOptions, string, number][] = [
    ['credenciales incorrectas', { loginStatus: 401 }, 'BONITA_AUTH_FAILED', 0],
    ['redirección inesperada', { loginStatus: 302 }, 'BONITA_AUTH_FAILED', 0],
    ['cookie de sesión ausente', { missingCookie: 'JSESSIONID' }, 'BONITA_AUTH_FAILED', 0],
    ['token CSRF ausente', { missingCookie: 'X-Bonita-API-Token' }, 'BONITA_AUTH_FAILED', 0],
    ['proceso inexistente', { processStatus: 404 }, 'BONITA_PROCESS_UNAVAILABLE', 0],
    ['proceso sin permisos', { processStatus: 403 }, 'BONITA_PROCESS_UNAVAILABLE', 0],
    ['proceso deshabilitado', { definition: { activationState: 'DISABLED' } }, 'BONITA_PROCESS_UNAVAILABLE', 0],
    ['configuración sin resolver', { definition: { configurationState: 'UNRESOLVED' } }, 'BONITA_PROCESS_UNAVAILABLE', 0],
    ['proceso diferente', { definition: { name: 'Otro' } }, 'BONITA_PROCESS_UNAVAILABLE', 0],
    ['inicio con HTTP 202', { startStatus: 202 }, 'BONITA_START_FAILED', 1],
    ['inicio con HTTP 204', { startStatus: 204 }, 'BONITA_START_FAILED', 1],
    ['inicio con redirección', { startStatus: 302 }, 'BONITA_START_FAILED', 1],
    ['inicio sin autenticación', { startStatus: 401 }, 'BONITA_START_FAILED', 1],
    ['contrato rechazado', { startStatus: 400 }, 'BONITA_START_FAILED', 1],
    ['inicio sin permisos', { startStatus: 403 }, 'BONITA_START_FAILED', 1],
    ['límite Community', { startStatus: 429 }, 'BONITA_START_FAILED', 1],
    ['error del motor', { startStatus: 500 }, 'BONITA_START_FAILED', 1],
    ['ID ausente con HTTP 200', { startStatus: 200, startBody: '{}' }, 'BONITA_INVALID_RESPONSE', 1],
    ['ID fuera de rango con HTTP 200', { startStatus: 200, startBody: '{"caseId":"9223372036854775808"}' }, 'BONITA_INVALID_RESPONSE', 1],
    ['JSON inválido con HTTP 200', { startStatus: 200, startBody: '<html>internal error</html>' }, 'BONITA_RESULT_UNKNOWN', 1],
    ['ID ausente', { startBody: '{}' }, 'BONITA_INVALID_RESPONSE', 1],
    ['ID fuera de rango', { startBody: '{"caseId":"9223372036854775808"}' }, 'BONITA_INVALID_RESPONSE', 1],
    ['JSON inválido', { startBody: '<html>internal error</html>' }, 'BONITA_RESULT_UNKNOWN', 1],
  ];
  for (const [name, options, code, starts] of scenarios) {
    it('maneja ' + name + ' sin reintentar ni filtrar detalles', async () => {
      const stub = await bonitaServer(options);
      try {
        await assert.rejects(createBonitaClient(stub.config).startProcess(), (error: unknown) => {
          assert.ok(error instanceof Error && 'code' in error);
          assert.equal(error.code, code);
          assert.doesNotMatch(error.message, /test-user|password|JSESSIONID|internal error/);
          return true;
        });
        assert.equal(stub.requests.filter((r) => r.path.endsWith('/instantiation')).length, starts);
        assert.ok(!stub.requests.some((r) => r.path === '/unexpected-redirect'));
      } finally { await stub.close(); }
    });
  }

  it('expresa resultado incierto al vencer el timeout de inicio y no reintenta', async () => {
    const stub = await bonitaServer({ delayStartMs: 1000 });
    try {
      await assert.rejects(createBonitaClient({ ...stub.config, timeoutMs: 200 }).startProcess(), {
        code: 'BONITA_TIMEOUT', message: /instancia podría existir/,
      });
      assert.equal(stub.requests.filter((r) => r.path.endsWith('/instantiation')).length, 1);
    } finally { await stub.close(); }
  });

  it('un fallo de logout no invalida la instancia creada', async () => {
    const stub = await bonitaServer({ logoutStatus: 500 });
    try { assert.equal(await createBonitaClient(stub.config).startProcess(), '9223372036854775806'); }
    finally { await stub.close(); }
  });

  it('informa conexión no disponible sin intentar iniciar', async () => {
    const stub = await bonitaServer();
    await stub.close();
    await assert.rejects(createBonitaClient(stub.config).startProcess(), { code: 'BONITA_CONNECTION_FAILED' });
  });

  it('deshabilitado no conecta ni exige credenciales y true/false se interpretan explícitamente', async () => {
    const base = { DATABASE_URL: 'postgresql://localhost/rescuesync', BONITA_ENABLED: 'false', BONITA_URL: 'invalid' };
    const env = readEnv(base);
    assert.deepEqual(env.bonita, { enabled: false });
    // The disabled implementation never reads the emergency.
    assert.equal(await createBonitaService(env.bonita).startRescueSyncProcess(undefined as never), null);
    assert.equal(readEnv({ DATABASE_URL: base.DATABASE_URL }).bonita.enabled, false);
    for (const value of ['yes', '0', 'FALSE']) assert.throws(() => readEnv({ ...base, BONITA_ENABLED: value }), /BONITA_ENABLED/);
    assert.throws(() => readEnv({ ...base, BONITA_ENABLED: 'true' }), /BONITA_URL.*BONITA_USERNAME.*BONITA_PASSWORD.*BONITA_PROCESS_ID/);
  });

  it('valida configuración habilitada sin conectarse a Bonita', () => {
    const source = { DATABASE_URL: 'postgresql://localhost/rescuesync', BONITA_ENABLED: 'true',
      BONITA_URL: 'http://localhost:8080/bonita', BONITA_USERNAME: 'test', BONITA_PASSWORD: 'secret-value',
      BONITA_PROCESS_ID: PROCESS_ID };
    assert.equal(readEnv(source).bonita.enabled, true);
    for (const [key, value] of [['BONITA_URL', 'ftp://localhost/bonita'], ['BONITA_PROCESS_ID', '1.5'], ['BONITA_TIMEOUT_MS', '0']]) {
      assert.throws(() => readEnv({ ...source, [key!]: value }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(key!));
        assert.ok(!error.message.includes('secret-value'));
        return true;
      });
    }
  });
});

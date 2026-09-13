import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBonitaClient } from '../src/integrations/bonita/bonita.client.js';
import { bonitaServer } from './helpers/bonita-server.js';

describe('Human Tasks: protocolo y desambiguación', () => {
  it('pagina todas las tareas y filtra caseId, ready y nombre exacto sin IDs fijos', async () => {
    const stub = await bonitaServer();
    try {
      for (let n = 0; n < 105; n++) stub.addTask('9', 'Visualizar notificacion', 'ong-' + n);
      stub.addTask('10', 'Otra tarea');
      const client = createBonitaClient(stub.config);
      assert.equal((await client.listReadyHumanTasks('9')).length, 105);
      const found = await client.findReadyHumanTask('9', 'Visualizar notificacion', 'ong-104');
      assert.equal(found?.id, stub.tasks[104]?.id);
      const searches = stub.requests.filter(r => r.path.includes('/humanTask?'));
      for (const search of searches) {
        const params = new URL(search.path, 'http://test').searchParams;
        assert.ok(params.getAll('f').includes('caseId=9'));
        assert.ok(params.getAll('f').includes('state=ready'));
      }
      assert.ok(searches.some(r => r.path.includes('p=1')));
    } finally { await stub.close(); }
  });
  it('tarea ausente devuelve null y completar por nombre no ejecuta; duplicadas fallan explícitamente', async () => {
    const stub = await bonitaServer();
    try {
      const client = createBonitaClient(stub.config);
      assert.equal(await client.findReadyHumanTask('9', 'Ausente'), null);
      await assert.rejects(client.completeTaskByName('9', 'Ausente'), { code: 'BONITA_TASK_NOT_FOUND' });
      stub.addTask('9', 'Duplicada'); stub.addTask('9', 'Duplicada');
      await assert.rejects(client.completeTaskByName('9', 'Duplicada'), { code: 'BONITA_TASK_AMBIGUOUS' });
      assert.equal(stub.requests.filter(r => r.path.includes('/execution')).length, 0);
    } finally { await stub.close(); }
  });
  it('rechaza respuestas cruzadas de caso y verifica nuevamente la tarea antes de ejecutar', async () => {
    const stub = await bonitaServer();
    try {
      const t = stub.addTask('10', 'Registrar emergencia');
      const client = createBonitaClient(stub.config);
      await assert.rejects(client.executeHumanTask(t.id, { emergenciaId: 'local' }, { caseId: '9', name: t.name }), { code: 'BONITA_TASK_MISMATCH' });
      stub.options.searchOverride = [t];
      await assert.rejects(client.findReadyHumanTask('9', t.name), { code: 'BONITA_TASK_MISMATCH' });
      assert.equal(stub.requests.filter(r => r.path.includes('/execution')).length, 0);
    } finally { await stub.close(); }
  });
  it('envía contratos, consulta contexto, asigna a la sesión y comprueba archivo tras ejecución', async () => {
    const stub = await bonitaServer();
    try {
      const t = stub.addTask('9', 'Registrar emergencia'); const client = createBonitaClient(stub.config);
      assert.deepEqual(await client.getTaskContext(t.id), {});
      const contract = await client.getTaskContract(t.id) as { inputs: { name: string }[] };
      assert.equal(contract.inputs[0]?.name, 'emergenciaId');
      await client.completeTaskByName('9', t.name, { emergenciaId: 'local-uuid' });
      assert.ok(await client.isTaskCompleted('9', t.id));
      const request = stub.requests.find(r => r.path.includes('/execution'))!;
      assert.equal(request.method, 'POST'); assert.equal(request.body, '{"emergenciaId":"local-uuid"}');
      assert.match(request.path, /assign=true/);
      assert.equal((await client.listReadyHumanTasks('9'))[0]?.name, 'Generar y publicar lotes');
    } finally { await stub.close(); }
  });
  it('no roba tareas asignadas ni ejecuta la tarea de otra ONG', async () => {
    const stub = await bonitaServer();
    try {
      const t = stub.addTask('9', 'Visualizar notificacion', 'ONG-A'); t.assigned_id = '123';
      const client = createBonitaClient(stub.config);
      await assert.rejects(client.executeHumanTask(t.id, {}, { caseId: '9', name: t.name, recipient: 'ONG-A' }), { code: 'BONITA_TASK_ASSIGNED' });
      await assert.rejects(client.executeHumanTask(t.id, {}, { caseId: '9', name: t.name, recipient: 'ONG-B' }), { code: 'BONITA_TASK_MISMATCH' });
      assert.equal(stub.requests.filter(r => r.path.includes('/execution')).length, 0);
    } finally { await stub.close(); }
  });
  for (const status of [400, 401, 403, 404, 500]) it('maneja búsqueda HTTP ' + status + ' sin exponer respuesta ni credenciales', async () => {
    const stub = await bonitaServer({ taskStatus: status });
    try { await assert.rejects(createBonitaClient(stub.config).listReadyHumanTasks('9'), { code: 'BONITA_HTTP_' + status }); }
    finally { await stub.close(); }
  });
  it('timeout de búsqueda limpia la sesión y no ejecuta tareas', async () => {
    const stub = await bonitaServer({ delayTaskMs: 200 });
    try {
      await assert.rejects(createBonitaClient({ ...stub.config, timeoutMs: 60 }).listReadyHumanTasks('9'), { code: 'BONITA_TIMEOUT' });
      assert.ok(stub.requests.some(r => r.path.includes('/logoutservice')));
      assert.equal(stub.requests.filter(r => r.path.includes('/execution')).length, 0);
    } finally { await stub.close(); }
  });
  it('no considera terminado un caso abierto sin tareas y distingue un ID desconocido', async () => {
    const stub = await bonitaServer();
    try {
      const t = stub.addTask('9', 'Espera'); t.state = 'completed';
      const client = createBonitaClient(stub.config);
      assert.deepEqual(await client.listReadyHumanTasks('9'), []);
      assert.equal((await client.getCaseState('9')).state, 'OPEN');
      assert.equal((await client.getCaseState('77')).state, 'UNKNOWN');
    } finally { await stub.close(); }
  });
});

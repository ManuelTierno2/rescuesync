import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { BonitaConfig } from '../../src/integrations/bonita/bonita.client.js';

export const PROCESS_ID = '5777042023671752656';
export interface StubOptions {
  loginStatus?: number; processStatus?: number; startStatus?: number; logoutStatus?: number;
  definition?: Record<string, unknown>; startBody?: string; delayStartMs?: number;
  missingCookie?: 'JSESSIONID' | 'X-Bonita-API-Token'; onStart?: () => Promise<void>;
  taskStatus?: number; executionStatus?: number; delayTaskMs?: number; delayExecutionMs?: number;
  searchOverride?: unknown[]; contractOverride?: unknown; onExecution?: (task: StubTask) => Promise<void>;
}
export interface StubTask { id: string; caseId: string; name: string; state: string; assigned_id: string; ongUsuarioId?: string }
let sequence = 100n;
export async function bonitaServer(options: StubOptions = {}) {
  const requests: { path: string; method: string; body: string; cookie: string; token: string }[] = [];
  const sessions = new Map<string, string>();
  const failures: unknown[] = [];
  const tasks: StubTask[] = [];
  const archivedTasks: (StubTask & { sourceObjectId: string })[] = [];
  const cases = new Map<string, { processId: string; completed: boolean; recipients: string[] }>();
  function addTask(caseId: string, name: string, ongUsuarioId?: string) {
    if (!cases.has(caseId)) cases.set(caseId, { processId: PROCESS_ID, completed: false, recipients: [] });
    const task: StubTask = { id: String(++sequence), caseId, name, state: 'ready', assigned_id: '0', ongUsuarioId };
    tasks.push(task); return task;
  }
  function expire(caseId: string, covered: boolean) {
    for (const t of tasks.filter(t => t.caseId === caseId && t.name === 'recibir ofertas')) t.state = 'aborted';
    addTask(caseId, covered ? 'Visualizar ofertas validas' : 'Decidir curso accion');
  }
  function advance(task: StubTask, values: Record<string, unknown>) {
    task.state = 'completed'; archivedTasks.push({ ...task, id: String(++sequence), sourceObjectId: task.id });
    const c = cases.get(task.caseId)!;
    const add = (name: string, recipient?: string) => addTask(task.caseId, name, recipient);
    switch (task.name) {
      case 'Registrar emergencia': add('Generar y publicar lotes'); break;
      case 'Generar y publicar lotes': add('recibir ofertas'); break;
      case 'Decidir curso accion': add(values.cursoAccion === 'REABRIR' ? 'recibir ofertas' : values.cursoAccion === 'REFORMULAR' ? 'Generar y publicar lotes' : 'Visualizar ofertas validas'); break;
      case 'Visualizar ofertas validas': add('Seleccionar ofertas'); break;
      case 'Seleccionar ofertas': c.recipients = values.ongDestinatarios as string[]; for (const r of c.recipients) add('Visualizar notificacion', r); break;
      case 'Visualizar notificacion':
        if (!tasks.some(t => t.caseId === task.caseId && t.name === task.name && t.state === 'ready')) {
          add('Monitorear despliegue'); for (const r of c.recipients) add('Marcar actividad finalizada', r);
        } break;
      case 'Monitorear despliegue': case 'Marcar actividad finalizada':
        if (!tasks.some(t => t.caseId === task.caseId && ['Monitorear despliegue', 'Marcar actividad finalizada'].includes(t.name) && t.state === 'ready')) add('Cerrar operativo');
        break;
      case 'Cerrar operativo': c.completed = true; break;
    }
  }
  const server = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const path = req.url || '';
      const cookie = String(req.headers.cookie || '');
      const token = String(req.headers['x-bonita-api-token'] || '');
      requests.push({ path, body, method: req.method || '', cookie, token });
      if (path === '/bonita/loginservice') {
        const sessionId = randomUUID();
        const tokenValue = randomUUID();
        sessions.set(sessionId, tokenValue);
        const values = [
          ['JSESSIONID', sessionId],
          ['X-Bonita-API-Token', tokenValue],
          ['bonita.tenant', '1'],
        ].filter(([key]) => key !== options.missingCookie);
        res.setHeader('Set-Cookie', values.map(([key, value]) => key + '=' + value + '; Path=/bonita; HttpOnly; Expires=Wed, 01 Jan 2031 00:00:00 GMT'));
        res.setHeader('Location', '/unexpected-redirect');
        res.statusCode = options.loginStatus ?? 204;
        res.end(); return;
      }
      const sessionId = /(?:^|; )JSESSIONID=([^;]+)/.exec(cookie)?.[1];
      if (!sessionId || sessions.get(sessionId) !== token || !cookie.includes('bonita.tenant=1')) {
        res.writeHead(401).end('Invalid session'); return;
      }
      res.setHeader('Content-Type', 'application/json');
      const url = new URL(path, 'http://stub');
      const pathname = url.pathname;
      const filter = (items: Record<string, unknown>[]) => items.filter(item => url.searchParams.getAll('f').every(f => {
        const at = f.indexOf('='); return String(item[f.slice(0, at)]) === f.slice(at + 1);
      }));
      const page = (items: Record<string, unknown>[]) => {
        const filtered = filter(items); const p = Number(url.searchParams.get('p')); const c = Number(url.searchParams.get('c'));
        res.setHeader('Content-Range', `${p * c}-${Math.min((p + 1) * c, filtered.length)}/${filtered.length}`);
        res.end(JSON.stringify(filtered.slice(p * c, (p + 1) * c)));
      };
      if (pathname === '/bonita/API/system/session/unusedId') { res.end('{"user_id":"42"}');
      } else if (pathname === '/bonita/API/bpm/humanTask') {
        if (options.delayTaskMs) await setTimeout(options.delayTaskMs);
        res.statusCode = options.taskStatus ?? 200;
        if (options.searchOverride) res.end(JSON.stringify(options.searchOverride));
        else page(tasks as unknown as Record<string, unknown>[]);
      } else if (pathname === '/bonita/API/bpm/archivedHumanTask') { page(archivedTasks as unknown as Record<string, unknown>[]);
      } else if (pathname === '/bonita/API/bpm/archivedCase') {
        page([...cases].filter(([, c]) => c.completed).map(([caseId]) => ({ id: String(++sequence), sourceObjectId: caseId, state: 'completed' })));
      } else if (pathname.startsWith('/bonita/API/bpm/case/')) {
        const caseId = pathname.split('/').at(-1)!; const c = cases.get(caseId);
        if (!c || c.completed) res.writeHead(404).end('{}');
        else res.end(JSON.stringify({ id: caseId, processDefinitionId: c.processId }));
      } else if (pathname.startsWith('/bonita/API/bpm/activityVariable/')) {
        const task = tasks.find(t => t.id === pathname.split('/').at(-2));
        if (!task?.ongUsuarioId) res.writeHead(404).end('{}');
        else res.end(JSON.stringify({ name: 'ongUsuarioId', value: task.ongUsuarioId }));
      } else if (pathname.startsWith('/bonita/API/bpm/userTask/')) {
        const parts = pathname.split('/'); const task = tasks.find(t => t.id === parts[5]);
        if (!task) { res.writeHead(404).end('{}'); return; }
        const sub = parts[6];
        if (sub === 'contract') {
          const name = task.name === 'Registrar emergencia' ? 'emergenciaId' : task.name === 'Decidir curso accion' ? 'cursoAccion' : task.name === 'Seleccionar ofertas' ? 'ongDestinatarios' : null;
          res.end(JSON.stringify(options.contractOverride ?? { inputs: name ? [{ name, type: 'TEXT', multiple: name === 'ongDestinatarios' }] : [] }));
        } else if (sub === 'context') res.end('{}');
        else if (sub === 'execution') {
          if (task.state !== 'ready') { res.writeHead(409).end('{}'); return; }
          if (options.executionStatus && options.executionStatus !== 204) { res.writeHead(options.executionStatus).end('{}'); return; }
          const values = JSON.parse(body) as Record<string, unknown>;
          if ((task.name === 'Registrar emergencia' && typeof values.emergenciaId !== 'string')
            || (task.name === 'Decidir curso accion' && !['REABRIR', 'REFORMULAR', 'PARCIAL'].includes(String(values.cursoAccion)))
            || (task.name === 'Seleccionar ofertas' && !Array.isArray(values.ongDestinatarios))) { res.writeHead(400).end('{}'); return; }
          await options.onExecution?.(task);
          advance(task, values);
          if (options.delayExecutionMs) await setTimeout(options.delayExecutionMs);
          res.writeHead(204).end();
        } else res.end(JSON.stringify(task));
      } else if (path === '/bonita/API/bpm/process/' + PROCESS_ID) {
        res.statusCode = options.processStatus ?? 200;
        res.end(JSON.stringify({ id: PROCESS_ID, name: 'RescueSync', activationState: 'ENABLED', configurationState: 'RESOLVED', ...options.definition }));
      } else if (path === '/bonita/API/bpm/process/' + PROCESS_ID + '/instantiation') {
        await options.onStart?.();
        if (options.delayStartMs) await setTimeout(options.delayStartMs);
        res.statusCode = options.startStatus ?? 201;
        const caseId = /"caseId"\s*:\s*"?(\d+)/.exec(options.startBody ?? '{"caseId":"9223372036854775806"}')?.[1];
        if (caseId) addTask(caseId, 'Registrar emergencia');
        res.end(options.startBody ?? '{"caseId":"9223372036854775806"}');
      } else if (path === '/bonita/logoutservice?redirect=false') {
        sessions.delete(sessionId);
        res.writeHead(options.logoutStatus ?? 200).end();
      } else res.writeHead(404).end();
    } catch (error) {
      failures.push(error);
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const config: Extract<BonitaConfig, { enabled: true }> = {
    enabled: true, url: 'http://127.0.0.1:' + address.port + '/bonita',
    username: 'test-user', password: 'test & password=+', processId: PROCESS_ID, timeoutMs: 3000,
  };
  return {
    tasks, archivedTasks, cases, addTask, expire, options,
    requests, failures, config,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}

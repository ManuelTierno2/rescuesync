export type BonitaConfig = { enabled: false } | {
  enabled: true; url: string; username: string; password: string; processId: string; timeoutMs: number;
};
export class BonitaError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'BonitaError'; }
}
export function isBonitaId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
function parseJson(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source: string }) =>
    typeof value === 'number' && context ? context.source : value);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function id(value: unknown): string {
  if (!isBonitaId(value)) throw new BonitaError('BONITA_INVALID_RESPONSE', 'Bonita devolvió un identificador inválido.');
  return value;
}
export interface HumanTask { id: string; name: string; caseId: string; state: string; assigned_id: string }
export interface CaseState { state: 'OPEN' | 'COMPLETED' | 'UNKNOWN'; processId?: string }
type Send = (path: string, options?: RequestInit, accepted?: number[]) => Promise<Response>;
export function createBonitaClient(config: Extract<BonitaConfig, { enabled: true }>) {
  const base = config.url.replace(/\/+$/, '');
  async function session<T>(operation: (send: Send) => Promise<T>): Promise<T> {
    const cookies = new Map<string, string>();
    const signal = AbortSignal.timeout(config.timeoutMs);
    let authenticated = false;
    async function raw(path: string, options: RequestInit = {}, requestSignal = signal) {
      const headers = new Headers(options.headers);
      if (cookies.size) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
      if (cookies.has('X-Bonita-API-Token')) headers.set('X-Bonita-API-Token', cookies.get('X-Bonita-API-Token')!);
      const response = await fetch(base + path, { ...options, headers, signal: requestSignal, redirect: 'manual' });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0]!; const index = pair.indexOf('=');
        if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      return response;
    }
    const send: Send = async (path, options = {}, accepted = [200]) => {
      const response = await raw(path, options);
      if (!accepted.includes(response.status)) {
        await response.body?.cancel();
        throw new BonitaError('BONITA_HTTP_' + response.status, 'Bonita rechazó la operación. Consultar el estado antes de repetirla.');
      }
      return response;
    };
    try {
      const login = await raw('/loginservice', { method: 'POST', body: new URLSearchParams({
        username: config.username, password: config.password, redirect: 'false',
      }) });
      await login.body?.cancel(); authenticated = login.status === 204;
      if (!authenticated || !cookies.has('JSESSIONID') || !cookies.has('X-Bonita-API-Token'))
        throw new BonitaError('BONITA_AUTH_FAILED', 'No se pudo autenticar la conexión con Bonita.');
      return await operation(send);
    } catch (error) {
      if (error instanceof BonitaError) throw error;
      throw new BonitaError(signal.aborted ? 'BONITA_TIMEOUT' : 'BONITA_CONNECTION_FAILED', 'No se pudo confirmar la operación en Bonita.');
    } finally {
      if (authenticated) {
        try { const response = await raw('/logoutservice?redirect=false', {}, AbortSignal.timeout(2000)); await response.body?.cancel(); }
        catch { /* Cleanup cannot invalidate an operation or cause it to be repeated. */ }
      }
      cookies.clear();
    }
  }
  async function json(send: Send, path: string) { return parseJson(await (await send(path)).text()); }
  function task(value: unknown): HumanTask {
    if (!record(value) || typeof value.name !== 'string' || typeof value.state !== 'string' || typeof value.assigned_id !== 'string')
      throw new BonitaError('BONITA_INVALID_RESPONSE', 'Bonita devolvió una tarea inválida.');
    return { id: id(value.id), caseId: id(value.caseId), name: value.name, state: value.state,
      assigned_id: value.assigned_id };
  }
  async function search(send: Send, resource: string, filters: string[]) {
    const all: unknown[] = [];
    for (let page = 0; page < 1000; page++) {
      const query = new URLSearchParams({ p: String(page), c: '100' });
      for (const filter of filters) query.append('f', filter);
      const response = await send(`/API/bpm/${resource}?${query}`);
      const values = parseJson(await response.text());
      if (!Array.isArray(values)) throw new BonitaError('BONITA_INVALID_RESPONSE', 'Bonita devolvió una búsqueda inválida.');
      all.push(...values);
      const range = response.headers.get('Content-Range');
      const total = range ? Number(range.split('/')[1]) : NaN;
      if (!values.length || (Number.isFinite(total) ? all.length >= total : values.length < 100)) return all;
    }
    throw new BonitaError('BONITA_SEARCH_LIMIT', 'No se pudo obtener la lista completa de tareas.');
  }
  async function ready(send: Send, caseId: string, name?: string) {
    id(caseId);
    const tasks = (await search(send, 'humanTask', ['state=ready', `caseId=${caseId}`, ...(name ? [`name=${name}`] : [])])).map(task);
    if (tasks.some(t => t.caseId !== caseId || t.state !== 'ready' || (name && t.name !== name)))
      throw new BonitaError('BONITA_TASK_MISMATCH', 'La tarea no corresponde al caso, nombre o estado esperado.');
    return tasks;
  }
  async function variable(send: Send, taskId: string, name: string) {
    const value = await json(send, `/API/bpm/activityVariable/${id(taskId)}/${encodeURIComponent(name)}`);
    if (!record(value) || !('value' in value)) throw new BonitaError('BONITA_INVALID_RESPONSE', 'Falta la variable de destinatario.');
    return value.value;
  }
  async function find(send: Send, caseId: string, name: string, recipient?: string) {
    let tasks = await ready(send, caseId, name);
    if (recipient) {
      const matches: HumanTask[] = [];
      for (const t of tasks) if (await variable(send, t.id, 'ongUsuarioId') === recipient) matches.push(t);
      tasks = matches;
    }
    if (tasks.length > 1) throw new BonitaError('BONITA_TASK_AMBIGUOUS', 'Hay varias tareas coincidentes; no se ejecutó ninguna.');
    return tasks[0] ?? null;
  }
  async function execute(send: Send, taskId: string, values: Record<string, unknown>, expected: { caseId: string; name: string; recipient?: string }) {
    const current = task(await json(send, `/API/bpm/userTask/${id(taskId)}`));
    if (current.caseId !== expected.caseId || current.name !== expected.name || current.state !== 'ready')
      throw new BonitaError('BONITA_TASK_MISMATCH', 'La tarea cambió o no pertenece al caso esperado.');
    if (expected.recipient && await variable(send, taskId, 'ongUsuarioId') !== expected.recipient)
      throw new BonitaError('BONITA_TASK_MISMATCH', 'La tarea pertenece a otra ONG.');
    const user = await json(send, '/API/system/session/unusedId');
    if (!record(user) || !isBonitaId(user.user_id)) throw new BonitaError('BONITA_INVALID_RESPONSE', 'No se pudo identificar la sesión.');
    if (current.assigned_id !== '0' && current.assigned_id !== '' && current.assigned_id !== user.user_id)
      throw new BonitaError('BONITA_TASK_ASSIGNED', 'La tarea está asignada a otro usuario Bonita.');
    await send(`/API/bpm/userTask/${taskId}/execution?assign=true`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
    }, [204]);
  }
  async function startProcess(): Promise<string> {
    let stage = 'process';
    try {
      return await session(async send => {
        let definition: unknown;
        try { definition = await json(send, `/API/bpm/process/${config.processId}`); }
        catch (e) { if (e instanceof BonitaError) throw new BonitaError('BONITA_PROCESS_UNAVAILABLE', 'La emergencia se guardó, pero no se pudo consultar RescueSync.'); throw e; }
        if (!record(definition) || definition.id !== config.processId || definition.name !== 'RescueSync'
          || definition.activationState !== 'ENABLED' || definition.configurationState !== 'RESOLVED')
          throw new BonitaError('BONITA_PROCESS_UNAVAILABLE', 'La emergencia se guardó, pero RescueSync no está habilitado y resuelto.');
        stage = 'start';
        let response: Response;
        try { response = await send(`/API/bpm/process/${config.processId}/instantiation`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        }, [200, 201]); }
        catch (e) { if (e instanceof BonitaError) throw new BonitaError('BONITA_START_FAILED', 'La emergencia se guardó, pero Bonita no confirmó el inicio. No repita el alta.'); throw e; }
        let value: unknown;
        try { value = parseJson(await response.text()); }
        catch { throw new BonitaError('BONITA_RESULT_UNKNOWN', 'La instancia podría existir; no repita el alta.'); }
        if (!record(value) || !isBonitaId(value.caseId)) throw new BonitaError('BONITA_INVALID_RESPONSE', 'La instancia podría existir, pero falta un ID válido. No repita el alta.');
        return value.caseId;
      });
    } catch (e) {
      if (stage === 'start' && e instanceof BonitaError && ['BONITA_TIMEOUT', 'BONITA_CONNECTION_FAILED'].includes(e.code))
        throw new BonitaError(e.code === 'BONITA_TIMEOUT' ? e.code : 'BONITA_RESULT_UNKNOWN', 'La emergencia se guardó; la instancia podría existir. No repita el alta.');
      throw e;
    }
  }
  return {
    startProcess,
    listReadyHumanTasks: (caseId: string) => session(send => ready(send, caseId)),
    findReadyHumanTask: (caseId: string, name: string, recipient?: string) => session(send => find(send, caseId, name, recipient)),
    getTaskContract: (taskId: string) => session(send => json(send, `/API/bpm/userTask/${id(taskId)}/contract`)),
    getTaskContext: (taskId: string) => session(send => json(send, `/API/bpm/userTask/${id(taskId)}/context`)),
    getActivityVariable: (taskId: string, name: string) => session(send => variable(send, taskId, name)),
    executeHumanTask: (taskId: string, values: Record<string, unknown>, expected: { caseId: string; name: string; recipient?: string }) => session(send => execute(send, taskId, values, expected)),
    completeTaskByName: (caseId: string, name: string, values: Record<string, unknown> = {}, recipient?: string) => session(async send => {
      const found = await find(send, caseId, name, recipient);
      if (!found) throw new BonitaError('BONITA_TASK_NOT_FOUND', 'La tarea todavía no está disponible.');
      await execute(send, found.id, values, { caseId, name, recipient }); return found;
    }),
    getCaseState: (caseId: string): Promise<CaseState> => session(async send => {
      const response = await send(`/API/bpm/case/${id(caseId)}`, {}, [200, 404]);
      if (response.status === 200) {
        const value = parseJson(await response.text());
        if (!record(value) || value.id !== caseId) throw new BonitaError('BONITA_INVALID_RESPONSE', 'Caso inválido.');
        return { state: 'OPEN', processId: id(value.processDefinitionId) };
      }
      await response.body?.cancel();
      const archived = await search(send, 'archivedCase', [`sourceObjectId=${caseId}`]);
      return { state: archived.some(v => record(v) && v.sourceObjectId === caseId && v.state === 'completed') ? 'COMPLETED' : 'UNKNOWN' };
    }),
    isTaskCompleted: (caseId: string, taskId: string) => session(async send => {
      const archived = await search(send, 'archivedHumanTask', [`caseId=${id(caseId)}`, `sourceObjectId=${id(taskId)}`]);
      return archived.some(v => record(v) && v.sourceObjectId === taskId && v.caseId === caseId && v.state === 'completed');
    }),
  };
}
export type BonitaClient = ReturnType<typeof createBonitaClient>;

export type BonitaConfig = { enabled: false } | {
  enabled: true;
  url: string;
  username: string;
  password: string;
  processId: string;
  timeoutMs: number;
};

export class BonitaError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BonitaError';
  }
}

export function isBonitaId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
    && BigInt(value) <= 9223372036854775807n;
}

// Node 24 supplies the original JSON token, before numeric precision is lost.
function parseBonitaJson(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source: string }) =>
    typeof value === 'number' && context ? context.source : value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createBonitaClient(config: Extract<BonitaConfig, { enabled: true }>) {
  const base = config.url.replace(/\/+$/, '');

  async function startProcess(): Promise<string> {
    const cookies = new Map<string, string>();
    let stage: 'login' | 'process' | 'start' = 'login';
    let authenticated = false;
    // One budget for the entire attempt, including reading response bodies.
    const signal = AbortSignal.timeout(config.timeoutMs);

    async function send(path: string, options: RequestInit, requestSignal = signal) {
      const headers = new Headers(options.headers);
      if (cookies.size) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
      const token = cookies.get('X-Bonita-API-Token');
      if (token) headers.set('X-Bonita-API-Token', token);
      const response = await fetch(`${base}${path}`, {
        ...options, headers, signal: requestSignal, redirect: 'manual',
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0]!;
        const index = pair.indexOf('=');
        if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      return response;
    }

    try {
      const login = await send('/loginservice', {
        method: 'POST',
        body: new URLSearchParams({ username: config.username, password: config.password, redirect: 'false' }),
      });
      await login.body?.cancel();
      authenticated = login.status === 204;
      if (!authenticated || !cookies.get('JSESSIONID') || !cookies.get('X-Bonita-API-Token')) {
        throw new BonitaError('BONITA_AUTH_FAILED', 'La emergencia se guardó, pero no se pudo autenticar la conexión con Bonita.');
      }

      stage = 'process';
      const process = await send(`/API/bpm/process/${config.processId}`, { method: 'GET' });
      if (process.status !== 200) {
        await process.body?.cancel();
        throw new BonitaError('BONITA_PROCESS_UNAVAILABLE', 'La emergencia se guardó, pero no se pudo consultar el proceso RescueSync configurado.');
      }
      const definition = parseBonitaJson(await process.text());
      if (!record(definition) || definition.id !== config.processId || definition.name !== 'RescueSync'
        || definition.activationState !== 'ENABLED' || definition.configurationState !== 'RESOLVED') {
        throw new BonitaError('BONITA_PROCESS_UNAVAILABLE', 'La emergencia se guardó, pero el proceso configurado no es un RescueSync habilitado y resuelto.');
      }

      stage = 'start';
      const started = await send(`/API/bpm/process/${config.processId}/instantiation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (started.status !== 200 && started.status !== 201) {
        await started.body?.cancel();
        throw new BonitaError('BONITA_START_FAILED', 'La emergencia se guardó, pero Bonita no confirmó el inicio del proceso. No repita el alta; revise las instancias en Bonita.');
      }
      const result = parseBonitaJson(await started.text());
      if (!record(result) || !isBonitaId(result.caseId)) {
        throw new BonitaError('BONITA_INVALID_RESPONSE', 'La emergencia se guardó, pero Bonita no devolvió un identificador válido. La instancia podría existir; no repita el alta.');
      }
      return result.caseId;
    } catch (error) {
      if (error instanceof BonitaError) throw error;
      if (stage === 'start') {
        throw new BonitaError(signal.aborted ? 'BONITA_TIMEOUT' : 'BONITA_RESULT_UNKNOWN',
          'La emergencia se guardó, pero no se pudo confirmar el inicio en Bonita. La instancia podría existir; no repita el alta.');
      }
      throw new BonitaError(signal.aborted ? 'BONITA_TIMEOUT' : 'BONITA_CONNECTION_FAILED',
        'La emergencia se guardó, pero no se pudo completar la conexión con Bonita.');
    } finally {
      if (authenticated) {
        try {
          const logout = await send('/logoutservice?redirect=false', { method: 'GET' }, AbortSignal.timeout(2000));
          await logout.body?.cancel();
        } catch { /* Session cleanup must not invalidate the result or trigger a second start. */ }
      }
      cookies.clear();
    }
  }

  return { startProcess };
}

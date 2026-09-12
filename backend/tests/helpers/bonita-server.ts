import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { BonitaConfig } from '../../src/integrations/bonita/bonita.client.js';

export const PROCESS_ID = '5777042023671752656';
export interface StubOptions {
  loginStatus?: number; processStatus?: number; startStatus?: number; logoutStatus?: number;
  definition?: Record<string, unknown>; startBody?: string; delayStartMs?: number;
  missingCookie?: 'JSESSIONID' | 'X-Bonita-API-Token'; onStart?: () => Promise<void>;
}
export async function bonitaServer(options: StubOptions = {}) {
  const requests: { path: string; method: string; body: string; cookie: string; token: string }[] = [];
  const sessions = new Map<string, string>();
  const failures: unknown[] = [];
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
      if (path === '/bonita/API/bpm/process/' + PROCESS_ID) {
        res.statusCode = options.processStatus ?? 200;
        res.end(JSON.stringify({ id: PROCESS_ID, name: 'RescueSync', activationState: 'ENABLED', configurationState: 'RESOLVED', ...options.definition }));
      } else if (path === '/bonita/API/bpm/process/' + PROCESS_ID + '/instantiation') {
        await options.onStart?.();
        if (options.delayStartMs) await setTimeout(options.delayStartMs);
        res.statusCode = options.startStatus ?? 201;
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
    requests, failures, config,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}

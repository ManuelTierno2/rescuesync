import { createServer, type Server } from 'node:http';

export interface SnCall { path: string; body: Record<string, unknown> }
export interface SnStubOptions { compromisoStatus?: number }

const CERTIFICACIONES = [
  { codigo: 'PARAMEDICO_ALTO', tipoRecurso: 'PARAMEDICO', nivelRiesgoMax: 'CRITICO' },
  { codigo: 'ALIMENTO_ALTO', tipoRecurso: 'RACION_ALIMENTO', nivelRiesgoMax: 'CRITICO' },
];

/** Stub HTTP del Sistema Nacional para tests (login, catálogo, sync, compromisos). */
export async function snServer(options: SnStubOptions = {}) {
  const calls: SnCall[] = [];
  let compromisoSeq = 100;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : {};
      const path = req.url ?? '';
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (path === '/login') { calls.push({ path, body }); return json(200, { token: 'sn-test-token', tokenType: 'Bearer', expiresIn: 28800, rol: 'ADMIN', ongId: null }); }
      calls.push({ path, body });
      if (req.headers.authorization !== 'Bearer sn-test-token') return json(401, { error: 'UNAUTHORIZED' });
      if (path === '/certificaciones') return json(200, CERTIFICACIONES);
      if (path === '/ongs') return json(201, { id: 1 });
      if (path === '/compromisos') {
        if (options.compromisoStatus && options.compromisoStatus >= 400) {
          return json(options.compromisoStatus, { error: 'SIN_DISPONIBILIDAD', detalle: 'stock insuficiente' });
        }
        return json(201, { id: ++compromisoSeq, estado: 'COMPROMETIDO' });
      }
      if (path === '/compromisos/liberar') return json(200, { liberados: 1 });
      return json(404, { error: 'NOT_FOUND' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    calls,
    config: { enabled: true as const, url: `http://127.0.0.1:${port}`, adminEmail: 'admin@sn.test', adminPassword: 'sn-test-pass', timeoutMs: 2000 },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

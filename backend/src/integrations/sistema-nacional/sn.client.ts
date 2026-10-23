export type SnConfig = { enabled: false } | {
  enabled: true;
  url: string;
  adminEmail: string;
  adminPassword: string;
  timeoutMs: number;
};

export class SnError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message);
    this.name = 'SnError';
  }
}

export interface SnResultadoValidacion {
  ofertaId: string;
  ongId: string | number;
  tipoRecurso: string;
  cantidad: number;
  nivelRiesgo: string;
  resultado: 'COMPLETA' | 'PARCIAL' | 'APOYO' | 'SIN_CAPACIDAD';
  cantidadValida: number;
  nivelRiesgoMax: string | null;
  disponible: number;
  motivo: string;
}

export interface SnCertificacion { codigo: string; tipoRecurso: string; nivelRiesgoMax: string }
export interface SnTipoRecurso { codigo: string; unidad: string }

export interface SnCompromisoResult {
  status: number;
  compromiso?: { id: number; [k: string]: unknown };
  repetido?: boolean;
  error?: string;
  detalle?: unknown;
}

export function createSnClient(config: Extract<SnConfig, { enabled: true }>) {
  const base = config.url.replace(/\/+$/, '');
  let token: string | null = null;
  let tokenExp = 0;

  async function raw(path: string, options: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(base + path, { ...options, signal: AbortSignal.timeout(config.timeoutMs), redirect: 'manual' });
    } catch (e) {
      throw new SnError('SN_UNREACHABLE', 'No se pudo contactar al Sistema Nacional.');
    }
  }
  async function login(): Promise<string> {
    if (token && Date.now() < tokenExp) return token;
    const res = await raw('/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: config.adminEmail, password: config.adminPassword }),
    });
    if (res.status !== 200) {
      await res.body?.cancel();
      throw new SnError('SN_AUTH_FAILED', 'El Sistema Nacional rechazó las credenciales de servicio.', res.status);
    }
    const body = await res.json() as { token?: string; expiresIn?: number };
    if (!body.token) throw new SnError('SN_INVALID_RESPONSE', 'El Sistema Nacional no devolvió token.');
    token = body.token;
    tokenExp = Date.now() + Math.max(60_000, ((body.expiresIn ?? 28_800) - 300) * 1000);
    return token;
  }
  async function call(path: string, options: RequestInit = {}): Promise<Response> {
    const t = await login();
    const res = await raw(path, { ...options, headers: { ...(options.headers ?? {}), Authorization: `Bearer ${t}` } });
    if (res.status === 401) { token = null; tokenExp = 0; }
    return res;
  }
  async function json(res: Response): Promise<Record<string, unknown>> {
    try { return await res.json() as Record<string, unknown>; } catch { return {}; }
  }

  return {
    async getCertificaciones(): Promise<SnCertificacion[]> {
      const res = await call('/certificaciones');
      if (res.status !== 200) throw new SnError('SN_CATALOG_FAILED', 'No se pudo obtener el catálogo del Sistema Nacional.', res.status);
      return await res.json() as SnCertificacion[];
    },
    /** Catálogo de tipos de recurso (códigos) que el SN acepta; lo define el SN, no este back. */
    async getTiposRecurso(): Promise<SnTipoRecurso[]> {
      const res = await call('/tipos-recurso');
      if (res.status !== 200) {
        await res.body?.cancel();
        throw new SnError('SN_CATALOG_FAILED', 'No se pudo obtener el catálogo de recursos del Sistema Nacional.', res.status);
      }
      const body = await json(res) as unknown;
      const list = Array.isArray(body) ? body : [];
      return list.filter((t): t is SnTipoRecurso => typeof t?.codigo === 'string' && typeof t?.unidad === 'string');
    },
    /** Alta/actualización idempotente de una ONG por externalId. */
    async syncOng(body: Record<string, unknown>): Promise<void> {
      const res = await call('/ongs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status !== 200 && res.status !== 201) {
        const b = await json(res);
        throw new SnError('SN_SYNC_FAILED', `El Sistema Nacional rechazó la sincronización de la ONG (${String(b.error ?? res.status)}).`, res.status);
      }
      await res.body?.cancel().catch(() => {});
    },
    async comprometer(body: { emergenciaId: string; loteId: string; ongId: string; items: { tipoRecurso: string; cantidad: number }[] }): Promise<SnCompromisoResult> {
      const res = await call('/compromisos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const b = await json(res);
      if (res.status === 200 || res.status === 201) {
        return { status: res.status, compromiso: b as SnCompromisoResult['compromiso'], repetido: Boolean(b.repetido) };
      }
      if (res.status >= 500) throw new SnError('SN_UNAVAILABLE', 'El Sistema Nacional no pudo procesar el compromiso.', res.status);
      return { status: res.status, error: String(b.error ?? 'Compromiso rechazado'), detalle: b.detalle };
    },
    /** Libera compromisos; 404 (nada para liberar) se reporta como 0 liberados. */
    async liberar(body: { emergenciaId: string; ongId?: string; loteId?: string }): Promise<{ status: number; liberados: number }> {
      const res = await call('/compromisos/liberar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 404) { await res.body?.cancel(); return { status: 404, liberados: 0 }; }
      if (res.status !== 200) throw new SnError('SN_LIBERAR_FAILED', 'El Sistema Nacional no pudo liberar los recursos.', res.status);
      const b = await json(res);
      return { status: 200, liberados: Number(b.liberados ?? 0) };
    },
  };
}

export type SnClient = ReturnType<typeof createSnClient>;

export type Role = 'MUNICIPIO' | 'COORDINADOR' | 'ONG' | 'AUDITOR';
export type Gravedad = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
export interface Usuario {
  id: string;
  nombre: string;
  email?: string;
  organizacion: string;
  organizacion_id?: string | null;
  rol: Role;
}
export interface Emergencia {
  id: string;
  creada_por_id: string;
  gravedad: Gravedad;
  zona: string;
  descripcion: string;
  bonita_instance_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface Lote {
  ronda_id: string | null;
  id: string;
  emergencia_id: string;
  tipo: 'PERSONAL' | 'RECURSO';
  descripcion: string;
  cantidad_requerida: number;
  unidad: string;
  created_at: string;
  updated_at: string;
}
export interface Oferta {
  activa: boolean;
  adjudicacion?: { id: string; created_at: string } | null;
  id: string;
  lote_id: string;
  ong_usuario_id: string;
  cantidad_ofrecida: number;
  observaciones: string | null;
  version: number;
  consorcio_id?: string | null;
  inventario_item_id?: string | null;
  ong_usuario: Usuario;
  created_at: string;
  updated_at: string;
}
export interface InventarioItem {
  id: string;
  ong_usuario_id: string;
  tipo: 'PERSONAL' | 'RECURSO';
  descripcion: string;
  cantidad: number;
  unidad: string;
  created_at: string;
  updated_at: string;
}
export interface Consorcio {
  id: string;
  nombre: string;
  creado_por_id: string;
  creado_por: Usuario;
  miembros: { id: string; ong_usuario_id: string; ong_usuario: Usuario }[];
  created_at: string;
}
export interface Organizacion {
  id: string;
  nombre: string;
  tipo: 'MUNICIPIO' | 'CENTRO_COORDINADOR' | 'ONG' | 'AUDITORIA';
  created_at: string;
}
export interface Warning {
  code: string;
  message: string;
}
export interface ApiResult<T> {
  data: T;
  warnings?: Warning[];
}
export interface ErrorDetail {
  field: string;
  message: string;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public code = 'CONNECTION_ERROR',
    public details: ErrorDetail[] = [],
  ) {
    super(message);
  }
}
const base = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/+$/, '');
const tokenKey = 'rescuesync.jwt';

export function getToken() {
  try {
    return localStorage.getItem(tokenKey) || '';
  } catch {
    return '';
  }
}

export function setToken(token: string) {
  try {
    if (token) localStorage.setItem(tokenKey, token);
    else localStorage.removeItem(tokenKey);
  } catch {
    /* ignore */
  }
}

export async function api<T>(
  path: string,
  options: { body?: unknown; method?: string; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  const method = options.method || (options.body !== undefined ? 'POST' : 'GET');
  const hasBody = options.body !== undefined;
  const token = getToken();
  let response: Response;
  try {
    response = await fetch(base + path, {
      method,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      method !== 'GET'
        ? 'No se pudo confirmar el resultado. Consulte los registros antes de repetir el envío.'
        : 'No se pudo conectar con la API. Compruebe que el backend esté disponible.',
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      method !== 'GET'
        ? 'La API devolvió una respuesta inesperada. Consulte los registros antes de repetir el envío.'
        : 'La API devolvió una respuesta inesperada.',
    );
  }
  if (!response.ok) {
    throw new ApiError(
      result.error?.message || 'No se pudo completar la solicitud.',
      result.error?.code,
      result.error?.details || [],
    );
  }
  if (!result || !('data' in result))
    throw new ApiError('La API devolvió una respuesta incompleta.');
  return result as ApiResult<T>;
}

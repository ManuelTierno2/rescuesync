export type Role = 'MUNICIPIO' | 'COORDINADOR' | 'ONG' | 'AUDITOR';
export type Gravedad = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
export interface Usuario {
  id: string;
  nombre: string;
  organizacion: string;
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
  ong_usuario: Usuario;
  created_at: string;
  updated_at: string;
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
let devUserId = '';
export function setApiUserId(id: string) { devUserId = id; }

export async function api<T>(
  path: string,
  options: { body?: unknown; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  const isPost = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(base + path, {
      method: isPost ? 'POST' : 'GET',
      headers: { ...(isPost ? { 'Content-Type': 'application/json' } : {}), ...(devUserId ? { 'X-Dev-User-Id': devUserId } : {}) },
      body: isPost ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      isPost
        ? 'No se pudo confirmar el resultado. Consulte los registros antes de repetir el envío.'
        : 'No se pudo conectar con la API. Compruebe que el backend esté disponible.',
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      isPost
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

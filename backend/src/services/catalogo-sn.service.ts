import { AppError } from '../errors/app-error.js';
import type { SnClient, SnTipoRecurso } from '../integrations/sistema-nacional/sn.client.js';

/**
 * Catálogo usado solo cuando el SN no está configurado (modo degradado/desarrollo).
 * Con el SN activo la fuente de verdad es su API (`GET /tipos-recurso`), por lo que un código nuevo
 * del SN queda disponible sin tocar este back.
 */
export const CODIGOS_SN_LOCAL: SnTipoRecurso[] = [
  { codigo: 'PARAMEDICO', unidad: 'persona' },
  { codigo: 'RACION_ALIMENTO', unidad: 'racion' },
  { codigo: 'AGUA_POTABLE', unidad: 'litro' },
  { codigo: 'KIT_MEDICO', unidad: 'kit' },
  { codigo: 'VEHICULO_RESCATE', unidad: 'vehiculo' },
];

export interface CatalogoSn { items: SnTipoRecurso[]; origen: 'SN' | 'LOCAL' }

export function createCatalogoSn(sn?: SnClient, ttlMs = 60_000) {
  let cache: { at: number; items: SnTipoRecurso[] } | null = null;

  /** Si el SN falla se usa la última copia conocida; sin copia, el error del SN llega al cliente (502). */
  async function listar(): Promise<CatalogoSn> {
    if (!sn) return { items: CODIGOS_SN_LOCAL, origen: 'LOCAL' };
    if (cache && Date.now() - cache.at < ttlMs) return { items: cache.items, origen: 'SN' };
    try {
      const items = await sn.getTiposRecurso();
      cache = { at: Date.now(), items };
      return { items, origen: 'SN' };
    } catch (error) {
      if (cache) return { items: cache.items, origen: 'SN' };
      throw error;
    }
  }

  async function validar(codigo: string): Promise<void> {
    const { items } = await listar();
    if (!items.some((t) => t.codigo === codigo)) {
      throw new AppError(422, 'CODIGO_SN_INVALIDO', `El código "${codigo}" no existe en el catálogo del Sistema Nacional.`);
    }
  }

  return { listar, validar };
}

export type CatalogoSnService = ReturnType<typeof createCatalogoSn>;

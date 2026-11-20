import { AppError } from '../errors/app-error.js';

export interface SnTipoRecurso { codigo: string; unidad: string }

/**
 * Códigos de recurso del catálogo nacional (los mismos que siembra el Sistema Nacional).
 * Es una copia local: la aplicación web no invoca la API del cloud (solo Bonita lo hace), así que
 * agregar un código nuevo en el SN requiere sumarlo también acá.
 */
export const CODIGOS_SN_LOCAL: SnTipoRecurso[] = [
  { codigo: 'PARAMEDICO', unidad: 'persona' },
  { codigo: 'RACION_ALIMENTO', unidad: 'racion' },
  { codigo: 'AGUA_POTABLE', unidad: 'litro' },
  { codigo: 'KIT_MEDICO', unidad: 'kit' },
  { codigo: 'VEHICULO_RESCATE', unidad: 'vehiculo' },
];

export interface CatalogoSn { items: SnTipoRecurso[]; origen: 'LOCAL' }

export function createCatalogoSn() {
  async function listar(): Promise<CatalogoSn> {
    return { items: CODIGOS_SN_LOCAL, origen: 'LOCAL' };
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

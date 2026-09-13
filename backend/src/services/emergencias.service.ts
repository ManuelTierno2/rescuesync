import { Prisma, type PrismaClient, type Emergencia } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import type { CrearEmergenciaInput } from '../validators/emergencias.schema.js';
import { createBonitaService, type BonitaService } from '../integrations/bonita/bonita.service.js';
import { BonitaError, isBonitaId } from '../integrations/bonita/bonita.client.js';
import { createWorkflowService, integrationWarning } from './workflow.service.js';

export interface IntegrationWarning { code: string; message: string }
export interface CrearEmergenciaResult { emergencia: Emergencia; warnings?: IntegrationWarning[] }

export async function crearEmergencia(prisma: PrismaClient, input: CrearEmergenciaInput,
  bonita: BonitaService = createBonitaService()): Promise<CrearEmergenciaResult> {
  const usuario = await prisma.usuario.findUnique({
    where: { id: input.creada_por_id },
    select: { rol: true },
  });
  if (!usuario || usuario.rol !== 'MUNICIPIO') {
    throw new AppError(422, 'INVALID_CREATOR', 'El autor debe ser un usuario municipal existente.');
  }

  let emergencia: Emergencia;
  try {
    emergencia = await prisma.emergencia.create({ data: { ...input, rondas: { create: { numero: 1 } } } });
  } catch (error) {
    // La FK también protege el alta si el usuario se elimina después de la consulta.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new AppError(422, 'INVALID_CREATOR', 'El autor debe ser un usuario municipal existente.');
    }
    throw error;
  }

  let instanceId: string | null;
  try {
    instanceId = await bonita.startRescueSyncProcess(emergencia);
    if (instanceId !== null && !isBonitaId(instanceId)) {
      throw new BonitaError('BONITA_INVALID_RESPONSE', 'La emergencia se guardó, pero el identificador recibido de Bonita no es válido. No repita el alta.');
    }
  } catch (error) {
    const warning = error instanceof BonitaError
      ? { code: error.code, message: error.message }
      : { code: 'BONITA_RESULT_UNKNOWN', message: 'La emergencia se guardó, pero no se pudo confirmar el inicio en Bonita. No repita el alta.' };
    console.warn(JSON.stringify({ code: warning.code, emergencia_id: emergencia.id }));
    return { emergencia, warnings: [warning] };
  }
  if (instanceId === null) return { emergencia };
  let updated: Emergencia;
  try {
    updated = await prisma.emergencia.update({
      where: { id: emergencia.id }, data: { bonita_instance_id: BigInt(instanceId) },
    });
  } catch {
    console.warn(JSON.stringify({ code: 'BONITA_LINK_FAILED', emergencia_id: emergencia.id, bonita_instance_id: instanceId }));
    return { emergencia, warnings: [{ code: 'BONITA_LINK_FAILED',
      message: `La emergencia ${emergencia.id} se guardó y Bonita inició la instancia ${instanceId}, pero no se pudo confirmar que el vínculo quedara guardado. No repita el alta.` }] };
  }
  try {
    const result = await createWorkflowService(prisma, bonita).register(updated.id, updated.creada_por_id);
    return { emergencia: updated, ...('warnings' in result ? { warnings: result.warnings } : {}) };
  } catch (error) {
    const warning = integrationWarning(error);
    console.warn(JSON.stringify({ code: warning.code, emergencia_id: updated.id }));
    return { emergencia: updated, warnings: [warning] };
  }
}

export async function listarEmergencias(prisma: PrismaClient) {
  return prisma.emergencia.findMany({ orderBy: [{ created_at: 'desc' }, { id: 'asc' }] });
}

export async function obtenerEmergencia(prisma: PrismaClient, id: string) {
  const emergencia = await prisma.emergencia.findUnique({ where: { id } });
  if (!emergencia) {
    throw new AppError(404, 'EMERGENCIA_NOT_FOUND', 'La emergencia no existe.');
  }
  return emergencia;
}

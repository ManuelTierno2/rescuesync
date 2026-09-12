import type { RequestHandler } from 'express';
import type { Emergencia, PrismaClient } from '../generated/prisma/client.js';
import { crearEmergencia, obtenerEmergencia } from '../services/emergencias.service.js';
import type { CrearEmergenciaInput, EmergenciaIdInput } from '../validators/emergencias.schema.js';

function serializeEmergencia(emergencia: Emergencia) {
  return {
    ...emergencia,
    bonita_instance_id: emergencia.bonita_instance_id?.toString() ?? null,
  };
}

export function createEmergenciasController(prisma: PrismaClient) {
  const crear: RequestHandler = async (_req, res) => {
    const input = res.locals.body as CrearEmergenciaInput;
    const emergencia = await crearEmergencia(prisma, input);
    res.status(201).location(`/api/emergencias/${emergencia.id}`)
      .json({ data: serializeEmergencia(emergencia) });
  };

  const obtener: RequestHandler = async (_req, res) => {
    const { id } = res.locals.params as EmergenciaIdInput;
    const emergencia = await obtenerEmergencia(prisma, id);
    res.json({ data: serializeEmergencia(emergencia) });
  };

  return { crear, obtener };
}

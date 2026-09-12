import type { RequestHandler } from 'express';
import type { Emergencia, PrismaClient } from '../generated/prisma/client.js';
import { crearEmergencia, obtenerEmergencia, listarEmergencias } from '../services/emergencias.service.js';
import type { BonitaService } from '../integrations/bonita/bonita.service.js';
import type { CrearEmergenciaInput, EmergenciaIdInput } from '../validators/emergencias.schema.js';

function serializeEmergencia(emergencia: Emergencia) {
  return {
    ...emergencia,
    bonita_instance_id: emergencia.bonita_instance_id?.toString() ?? null,
  };
}

export function createEmergenciasController(prisma: PrismaClient, bonita?: BonitaService) {
  const crear: RequestHandler = async (_req, res) => {
    const input = res.locals.body as CrearEmergenciaInput;
    const { emergencia, warnings } = await crearEmergencia(prisma, input, bonita);
    res.status(201).location(`/api/emergencias/${emergencia.id}`)
      .json({ data: serializeEmergencia(emergencia), ...(warnings ? { warnings } : {}) });
  };

  const obtener: RequestHandler = async (_req, res) => {
    const { id } = res.locals.params as EmergenciaIdInput;
    const emergencia = await obtenerEmergencia(prisma, id);
    res.json({ data: serializeEmergencia(emergencia) });
  };

  const listar: RequestHandler = async (_req, res) => {
    res.json({ data: (await listarEmergencias(prisma)).map(serializeEmergencia) });
  };
  return { crear, obtener, listar };
}

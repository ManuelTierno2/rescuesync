import type { RequestHandler } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { listarLotes, crearLote } from '../services/lotes.service.js';
import type { CrearLoteInput, EmergenciaLotesParams } from '../validators/lotes.schema.js';

export function createLotesController(prisma: PrismaClient) {
  const listar: RequestHandler = async (_req, res) => {
    const { emergenciaId } = res.locals.params as EmergenciaLotesParams;
    res.json({ data: await listarLotes(prisma, emergenciaId) });
  };
  const crear: RequestHandler = async (_req, res) => {
    const { emergenciaId } = res.locals.params as EmergenciaLotesParams;
    const input = res.locals.body as CrearLoteInput;
    res.status(201).json({ data: await crearLote(prisma, emergenciaId, input) });
  };
  return { listar, crear };
}

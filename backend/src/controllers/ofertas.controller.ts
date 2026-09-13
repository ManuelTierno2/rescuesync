import type { RequestHandler } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { listarOfertas, crearOferta } from '../services/ofertas.service.js';
import type { CrearOfertaInput, LoteOfertasParams } from '../validators/ofertas.schema.js';
import { devActor } from '../routes/workflow.routes.js';
import { AppError } from '../errors/app-error.js';

export function createOfertasController(prisma: PrismaClient) {
  const listar: RequestHandler = async (_req, res) => {
    const { loteId } = res.locals.params as LoteOfertasParams;
    res.json({ data: await listarOfertas(prisma, loteId) });
  };
  const crear: RequestHandler = async (req, res) => {
    const { loteId } = res.locals.params as LoteOfertasParams;
    const input = res.locals.body as CrearOfertaInput;
    if (devActor(req) !== input.ong_usuario_id) throw new AppError(403, 'FORBIDDEN_OWNER', 'La oferta debe pertenecer al usuario seleccionado.');
    res.status(201).json({ data: await crearOferta(prisma, loteId, input) });
  };
  return { listar, crear };
}

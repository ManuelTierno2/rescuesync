import type { RequestHandler } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { listarOfertas, crearOferta, actualizarOferta, listarHistorialOferta } from '../services/ofertas.service.js';
import type {
  ActualizarOfertaInput,
  CrearOfertaInput,
  LoteOfertasParams,
  OfertaIdParams,
} from '../validators/ofertas.schema.js';
import { AppError } from '../errors/app-error.js';

export function createOfertasController(prisma: PrismaClient) {
  const listar: RequestHandler = async (_req, res) => {
    const { loteId } = res.locals.params as LoteOfertasParams;
    res.json({ data: await listarOfertas(prisma, loteId) });
  };
  const crear: RequestHandler = async (req, res) => {
    const { loteId } = res.locals.params as LoteOfertasParams;
    const input = res.locals.body as CrearOfertaInput;
    if (!req.user || req.user.id !== input.ong_usuario_id) {
      throw new AppError(403, 'FORBIDDEN_OWNER', 'La oferta debe pertenecer al usuario autenticado.');
    }
    res.status(201).json({ data: await crearOferta(prisma, loteId, input) });
  };
  const actualizar: RequestHandler = async (req, res) => {
    const { id } = res.locals.params as OfertaIdParams;
    const input = res.locals.body as ActualizarOfertaInput;
    res.json({ data: await actualizarOferta(prisma, id, req.user!.id, input) });
  };
  const historial: RequestHandler = async (_req, res) => {
    const { id } = res.locals.params as OfertaIdParams;
    res.json({ data: await listarHistorialOferta(prisma, id) });
  };
  return { listar, crear, actualizar, historial };
}

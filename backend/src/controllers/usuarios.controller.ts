import type { RequestHandler } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { listarUsuarios } from '../services/usuarios.service.js';

export function createUsuariosController(prisma: PrismaClient) {
  const listar: RequestHandler = async (_req, res) => {
    res.json({ data: await listarUsuarios(prisma) });
  };
  return { listar };
}

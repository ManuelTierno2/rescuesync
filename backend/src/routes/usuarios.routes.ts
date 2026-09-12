import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createUsuariosController } from '../controllers/usuarios.controller.js';

export function createUsuariosRouter(prisma: PrismaClient) {
  const router = Router();
  router.get('/', createUsuariosController(prisma).listar);
  return router;
}

import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import { validate } from '../middlewares/validate.js';
import { createAuthMiddleware } from '../middlewares/auth.js';
import { createAuthService } from '../services/auth.service.js';
import type { AuthConfig } from '../config/env.js';
import { readAuthConfig } from '../config/env.js';

const loginSchema = z.strictObject({
  email: z.email({ error: 'Email inválido.' }).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, 'La contraseña es obligatoria.').max(200),
});

const registerSchema = z.strictObject({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(120),
  email: z.email({ error: 'Email inválido.' }).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(200),
  organizacion: z.string().trim().min(1, 'La organización es obligatoria.').max(150),
});

export function createAuthRouter(prisma: PrismaClient, authConfig: AuthConfig = readAuthConfig()) {
  const router = Router();
  const auth = createAuthService(prisma, authConfig);
  const { requireAuth } = createAuthMiddleware(prisma, authConfig);

  router.post('/login', validate(loginSchema, 'body'), async (_req, res) => {
    const body = res.locals.body as z.infer<typeof loginSchema>;
    res.json({ data: await auth.login(body.email, body.password) });
  });

  router.post('/register', validate(registerSchema, 'body'), async (_req, res) => {
    const body = res.locals.body as z.infer<typeof registerSchema>;
    res.status(201).json({ data: await auth.registerOng(body) });
  });

  router.get('/me', requireAuth, async (req, res) => {
    res.json({ data: await auth.me(req.user!.id) });
  });

  return router;
}

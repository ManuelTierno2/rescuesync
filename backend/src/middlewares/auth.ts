import type { Request, RequestHandler, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { PrismaClient, RolUsuario } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import { readAuthConfig, type AuthConfig } from '../config/env.js';
import { verifyToken, type AuthUser } from '../services/auth.service.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      authConfig?: AuthConfig;
    }
  }
}

const uuid = z.uuid();

async function loadUser(prisma: PrismaClient, id: string): Promise<AuthUser> {
  const user = await prisma.usuario.findUnique({
    where: { id },
    select: { id: true, nombre: true, email: true, rol: true, organizacion: true, organizacion_id: true },
  });
  if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Usuario no encontrado.');
  return user;
}

export async function resolveActorId(
  req: Request,
  config: AuthConfig = req.authConfig ?? readAuthConfig(),
): Promise<string> {
  if (req.user?.id) return req.user.id;
  const header = req.get('Authorization');
  if (header?.startsWith('Bearer ')) {
    const payload = await verifyToken(header.slice(7).trim(), config);
    return payload.sub;
  }
  if (config.allowDevHeader) {
    const raw = req.get('X-Dev-User-Id');
    if (raw) {
      const result = uuid.safeParse(raw);
      if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', 'X-Dev-User-Id inválido.');
      return result.data;
    }
  }
  throw new AppError(401, 'UNAUTHORIZED', 'Se requiere autenticación.');
}

export function createAuthMiddleware(prisma: PrismaClient, config: AuthConfig = readAuthConfig()) {
  const requireAuth: RequestHandler = async (req, _res, next) => {
    try {
      req.authConfig = config;
      const header = req.get('Authorization');
      if (header?.startsWith('Bearer ')) {
        const payload = await verifyToken(header.slice(7).trim(), config);
        req.user = await loadUser(prisma, payload.sub);
        return next();
      }
      if (config.allowDevHeader) {
        const raw = req.get('X-Dev-User-Id');
        if (raw) {
          const result = uuid.safeParse(raw);
          if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', 'X-Dev-User-Id inválido.');
          req.user = await loadUser(prisma, result.data);
          return next();
        }
      }
      throw new AppError(401, 'UNAUTHORIZED', 'Se requiere autenticación.');
    } catch (error) {
      next(error);
    }
  };

  function requireRole(...roles: RolUsuario[]): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      await requireAuth(req, res, (err?: unknown) => {
        if (err) return next(err);
        try {
          if (!req.user || !roles.includes(req.user.rol)) {
            throw new AppError(403, 'FORBIDDEN_ROLE', 'El usuario no puede realizar esta acción.');
          }
          next();
        } catch (error) {
          next(error);
        }
      });
    };
  }

  return { requireAuth, requireRole, config };
}

/** @deprecated Use resolveActorId from auth middleware. Kept as alias for gradual migration. */
export { resolveActorId as resolveActor };

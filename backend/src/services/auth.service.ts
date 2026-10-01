import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { PrismaClient, RolUsuario } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import { readAuthConfig, type AuthConfig } from '../config/env.js';
import { usuarioPublicSelect } from './usuarios.service.js';

const BCRYPT_ROUNDS = 10;

export type AuthUser = {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  organizacion: string;
  organizacion_id: string | null;
};

export type JwtPayload = {
  sub: string;
  rol: RolUsuario;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string | null | undefined) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export async function signToken(user: { id: string; rol: RolUsuario }, config: AuthConfig = readAuthConfig()) {
  const secret = new TextEncoder().encode(config.jwtSecret);
  return new SignJWT({ rol: user.rol } satisfies Omit<JwtPayload, 'sub'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiresIn)
    .sign(secret);
}

export async function verifyToken(token: string, config: AuthConfig = readAuthConfig()): Promise<JwtPayload> {
  try {
    const secret = new TextEncoder().encode(config.jwtSecret);
    const { payload } = await jwtVerify(token, secret);
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const rol = payload.rol;
    if (!sub || (rol !== 'MUNICIPIO' && rol !== 'COORDINADOR' && rol !== 'ONG' && rol !== 'AUDITOR')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Token inválido.');
    }
    return { sub, rol };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, 'UNAUTHORIZED', 'Token inválido o expirado.');
  }
}

function toAuthUser(user: {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  organizacion: string;
  organizacion_id: string | null;
}): AuthUser {
  return {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    organizacion: user.organizacion,
    organizacion_id: user.organizacion_id,
  };
}

export function createAuthService(prisma: PrismaClient, config: AuthConfig = readAuthConfig()) {
  async function login(email: string, password: string) {
    const user = await prisma.usuario.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { ...usuarioPublicSelect, email: true, password_hash: true, organizacion_id: true },
    });
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos.');
    }
    const token = await signToken(user, config);
    return { token, user: toAuthUser(user) };
  }

  async function registerOng(input: { nombre: string; email: string; password: string; organizacion: string }) {
    const email = input.email.trim().toLowerCase();
    const existing = await prisma.usuario.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new AppError(409, 'EMAIL_TAKEN', 'Ya existe un usuario con ese email.');
    const password_hash = await hashPassword(input.password);
    const user = await prisma.$transaction(async (tx) => {
      const org = await tx.organizacion.create({
        data: { nombre: input.organizacion.trim(), tipo: 'ONG' },
      });
      return tx.usuario.create({
        data: {
          nombre: input.nombre.trim(),
          email,
          password_hash,
          rol: 'ONG',
          organizacion: input.organizacion.trim(),
          organizacion_id: org.id,
        },
        select: { ...usuarioPublicSelect, email: true, organizacion_id: true },
      });
    });
    const token = await signToken(user, config);
    return { token, user: toAuthUser(user) };
  }

  async function me(userId: string) {
    const user = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { ...usuarioPublicSelect, email: true, organizacion_id: true },
    });
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Usuario no encontrado.');
    return toAuthUser(user);
  }

  return { login, registerOng, me, config };
}

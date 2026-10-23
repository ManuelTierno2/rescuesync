import 'dotenv/config';
import { z } from 'zod';
import { isBonitaId, type BonitaConfig } from '../integrations/bonita/bonita.client.js';
import type { SnConfig } from '../integrations/sistema-nacional/sn.client.js';

export class EnvError extends Error {
  constructor(fields: string[]) {
    super(`Configuración inválida: revisar ${fields.join(', ')} en las variables de entorno.`);
    this.name = 'EnvError';
  }
}

export const databaseUrlSchema = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && url.pathname.length > 1;
  } catch {
    return false;
  }
}, 'Se requiere una URL PostgreSQL con el nombre de la base.');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: databaseUrlSchema,
  BONITA_ENABLED: z.enum(['true', 'false']).default('false'),
  BONITA_WORKFLOW_PROCESS_IDS: z.string().default('').refine(v => !v || v.split(',').every(id => isBonitaId(id.trim()))),
  BONITA_CALLBACK_SECRET: z.string().default('').refine(v => !v || v.length >= 32),
  OFERTAS_VALIDACION_MODE: z.enum(['PENDIENTE', 'DESARROLLO']).default('PENDIENTE'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres.'),
  JWT_EXPIRES_IN: z.string().trim().min(1).default('8h'),
  AUTH_ALLOW_DEV_HEADER: z.enum(['true', 'false']).optional(),
  SN_API_URL: z.string().default(''),
  SN_ADMIN_EMAIL: z.string().default(''),
  SN_ADMIN_PASSWORD: z.string().default(''),
  SN_TIMEOUT_MS: z.coerce.number().int().min(1).max(60000).default(10000),
});

const bonitaSchema = z.object({
  BONITA_URL: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }).default('http://localhost:8080/bonita'),
  BONITA_USER_MUNICIPIO: z.string().trim().min(1),
  BONITA_PASS_MUNICIPIO: z.string().min(1),
  BONITA_USER_COORDINADOR: z.string().trim().min(1),
  BONITA_PASS_COORDINADOR: z.string().min(1),
  BONITA_USER_ONG: z.string().trim().min(1),
  BONITA_PASS_ONG: z.string().min(1),
  BONITA_PROCESS_ID: z.string().refine(isBonitaId),
  BONITA_TIMEOUT_MS: z.coerce.number().int().min(1).max(60000).default(10000),
});

export type AuthConfig = {
  jwtSecret: string;
  jwtExpiresIn: string;
  allowDevHeader: boolean;
};

export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new EnvError(fields);
  }
  let bonita: BonitaConfig = { enabled: false };
  if (result.data.BONITA_ENABLED === 'true') {
    const settings = bonitaSchema.safeParse(source);
    if (!settings.success) {
      const fields = [...new Set(settings.error.issues.map((issue) => issue.path.join('.')))];
      throw new EnvError(fields);
    }
    bonita = {
      enabled: true,
      url: settings.data.BONITA_URL,
      credentials: {
        municipio: { username: settings.data.BONITA_USER_MUNICIPIO, password: settings.data.BONITA_PASS_MUNICIPIO },
        coordinador: { username: settings.data.BONITA_USER_COORDINADOR, password: settings.data.BONITA_PASS_COORDINADOR },
        ong: { username: settings.data.BONITA_USER_ONG, password: settings.data.BONITA_PASS_ONG },
      },
      processId: settings.data.BONITA_PROCESS_ID,
      timeoutMs: settings.data.BONITA_TIMEOUT_MS,
    };
  }
  let sn: SnConfig = { enabled: false };
  const snFields = [result.data.SN_API_URL, result.data.SN_ADMIN_EMAIL, result.data.SN_ADMIN_PASSWORD];
  if (snFields.some(v => v !== '')) {
    const okUrl = z.url().safeParse(result.data.SN_API_URL).success;
    if (!okUrl || snFields.some(v => v === '')) throw new EnvError(['SN_API_URL', 'SN_ADMIN_EMAIL', 'SN_ADMIN_PASSWORD']);
    sn = { enabled: true, url: result.data.SN_API_URL, adminEmail: result.data.SN_ADMIN_EMAIL, adminPassword: result.data.SN_ADMIN_PASSWORD, timeoutMs: result.data.SN_TIMEOUT_MS };
  }
  const allowDevHeader = result.data.AUTH_ALLOW_DEV_HEADER
    ? result.data.AUTH_ALLOW_DEV_HEADER === 'true'
    : result.data.NODE_ENV === 'test';
  return {
    ...result.data,
    bonita,
    sn,
    auth: {
      jwtSecret: result.data.JWT_SECRET,
      jwtExpiresIn: result.data.JWT_EXPIRES_IN,
      allowDevHeader,
    } satisfies AuthConfig,
  };
}

/** Lectura laxa para tests/middleware cuando no se pasa por server.ts. */
export function readAuthConfig(source: NodeJS.ProcessEnv = process.env): AuthConfig {
  const secret = source.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new EnvError(['JWT_SECRET']);
  }
  const nodeEnv = source.NODE_ENV === 'test' || source.NODE_ENV === 'production' ? source.NODE_ENV : 'development';
  const allowDevHeader = source.AUTH_ALLOW_DEV_HEADER
    ? source.AUTH_ALLOW_DEV_HEADER === 'true'
    : nodeEnv === 'test';
  return {
    jwtSecret: secret,
    jwtExpiresIn: source.JWT_EXPIRES_IN?.trim() || '8h',
    allowDevHeader,
  };
}

import 'dotenv/config';
import { z } from 'zod';
import { isBonitaId, type BonitaConfig } from '../integrations/bonita/bonita.client.js';

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
});

const bonitaSchema = z.object({
  BONITA_URL: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }).default('http://localhost:8080/bonita'),
  BONITA_USERNAME: z.string().trim().min(1),
  BONITA_PASSWORD: z.string().min(1),
  BONITA_PROCESS_ID: z.string().refine(isBonitaId),
  BONITA_TIMEOUT_MS: z.coerce.number().int().min(1).max(60000).default(10000),
});

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
      enabled: true, url: settings.data.BONITA_URL, username: settings.data.BONITA_USERNAME,
      password: settings.data.BONITA_PASSWORD, processId: settings.data.BONITA_PROCESS_ID,
      timeoutMs: settings.data.BONITA_TIMEOUT_MS,
    };
  }
  return { ...result.data, bonita };
}

import 'dotenv/config';
import { z } from 'zod';

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
});

export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Configuración inválida: revisar ${fields.join(', ')} en las variables de entorno.`);
  }
  return result.data;
}

import { databaseUrlSchema } from '../../src/config/env.js';

/** Defaults de auth para la suite de pruebas (NODE_ENV del proceso suele ser development vía dotenv). */
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters!!';
}
process.env.JWT_EXPIRES_IN ??= '8h';
process.env.AUTH_ALLOW_DEV_HEADER = 'true';

export function testDatabaseUrl() {
  const testUrl = databaseUrlSchema.safeParse(process.env.TEST_DATABASE_URL);
  if (!testUrl.success) throw new Error('Configurar TEST_DATABASE_URL con una base PostgreSQL exclusiva para pruebas.');
  const name = decodeURIComponent(new URL(testUrl.data).pathname.slice(1));
  const appUrl = databaseUrlSchema.safeParse(process.env.DATABASE_URL);
  if (!name.endsWith('_test') || (appUrl.success && decodeURIComponent(new URL(appUrl.data).pathname.slice(1)) === name)) {
    throw new Error('La base de pruebas debe terminar en _test y ser distinta de DATABASE_URL.');
  }
  return testUrl.data;
}

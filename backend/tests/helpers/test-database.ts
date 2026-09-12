import { databaseUrlSchema } from '../../src/config/env.js';

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

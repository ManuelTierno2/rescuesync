import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { databaseUrlSchema } from './src/config/env.js';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // Prisma solo necesita la URL; no validar credenciales Bonita en migrate/seed.
  datasource: { url: databaseUrlSchema.parse(process.env.DATABASE_URL) },
});

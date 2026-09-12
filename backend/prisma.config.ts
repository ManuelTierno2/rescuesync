import { defineConfig } from 'prisma/config';
import { readEnv } from './src/config/env.js';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: { url: readEnv().DATABASE_URL },
});

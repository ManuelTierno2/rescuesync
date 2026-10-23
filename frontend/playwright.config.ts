import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';

process.env.BROWSER_TEST_RUN_ID = 'E2E-' + randomUUID();
// Configurable para convivir con el Sistema Nacional local, que usa el 3001.
const apiPort = process.env.E2E_API_PORT ?? '3001';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  retries: 0,
  use: { baseURL: 'http://localhost:5174', browserName: 'chromium', headless: true },
  webServer: [
    {
      command: 'node --import ./node_modules/tsx/dist/loader.mjs tests/helpers/browser-server.ts',
      cwd: '../backend',
      url: `http://127.0.0.1:${apiPort}/api/usuarios`,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --host localhost --port 5174',
      url: 'http://localhost:5174',
      env: { VITE_API_URL: `http://127.0.0.1:${apiPort}/api` },
      reuseExistingServer: false,
    },
  ],
});

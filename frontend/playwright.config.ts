import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';

process.env.BROWSER_TEST_RUN_ID = 'E2E-' + randomUUID();
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  retries: 0,
  use: { baseURL: 'http://localhost:5173', browserName: 'chromium', headless: true },
  webServer: [
    {
      command: 'node --import ./node_modules/tsx/dist/loader.mjs tests/helpers/browser-server.ts',
      cwd: '../backend',
      url: 'http://127.0.0.1:3001/api/usuarios',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --host localhost',
      url: 'http://localhost:5173',
      env: { VITE_API_URL: 'http://127.0.0.1:3001/api' },
      reuseExistingServer: false,
    },
  ],
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/portal/**',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:1432',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1432', reuseExistingServer: true },
  reporter: 'list',
});

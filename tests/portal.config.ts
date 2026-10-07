import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/portal',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:1433',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 1433 --host 127.0.0.1',
    env: { VITE_DECK_PORTAL: 'true' },
    url: 'http://127.0.0.1:1433',
    reuseExistingServer: false,
  },
  reporter: 'list',
});

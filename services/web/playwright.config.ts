import { defineConfig, devices } from '@playwright/test';

import { CONTROL_PLANE_PORT, SPA_PORT, SPA_URL } from './e2e/env';

/**
 * Integrated suite: the SPA under `ng serve` talks through its dev proxy to the real control plane
 * started by e2e/global-setup.ts. The specs share one database and run in order.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  timeout: 60_000,
  reporter: process.env['CI'] ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: SPA_URL,
    trace: 'retain-on-failure',
    locale: 'pt-BR',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx ng serve --port ${SPA_PORT} --proxy-config e2e/proxy.conf.cjs`,
    url: SPA_URL,
    env: { E2E_CONTROL_PLANE_PORT: String(CONTROL_PLANE_PORT) },
    timeout: 120_000,
    reuseExistingServer: false,
  },
});

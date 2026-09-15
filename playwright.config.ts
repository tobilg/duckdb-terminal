import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  use: { baseURL: 'http://127.0.0.1:4174/nested/', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @duckdb-terminal/website exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @duckdb-terminal/website exec vite preview --config ../../tests/browser/vite.config.mts --host 127.0.0.1 --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174/nested/',
      reuseExistingServer: !process.env.CI,
    },
  ],
});

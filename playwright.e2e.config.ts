import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /t33-.*\.spec\.ts$/,
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    trace: 'off',
  },
  webServer: {
    command: 'npm run dev:web',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173/HandSketch/',
    viewport: { width: 1360, height: 1100 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/HandSketch/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});

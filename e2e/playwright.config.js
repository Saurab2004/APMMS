import { defineConfig } from '@playwright/test';

// Multi-user session tests. The app must already be running (see README.md in this folder).
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  workers: 1, // all tests share one database
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5000',
    // Optional: use an already-installed Chromium instead of the one Playwright downloads.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});

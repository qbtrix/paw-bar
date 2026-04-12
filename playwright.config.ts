// playwright.config.ts — Minimal config for the widget's DOM + event tests.
// Created: 2026-04-13 — Static file fixture served over HTTP so the widget
// can mount normally, run the DOM render path, and POST to a stub endpoint
// mocked via page.route().

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 15_000,
  reporter: [['list']],
  webServer: {
    command: 'bun x http-server tests/fixtures -p 4173 -c-1 --silent',
    port: 4173,
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

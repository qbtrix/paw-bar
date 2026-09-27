// playwright.sandbox.config.ts — the widget frame sandbox, in three engines.
// Created 2026-09-26: separate from playwright.config.ts (the legacy vanilla
// widget suite, which is not in CI) so neither setup disturbs the other. No
// webServer: tests/sandbox/servers.ts starts both origins per worker, because
// the host page has to be told the frame origin's port.
// Needs `bun run build:loader` first; the host page serves loader/dist/loader.js.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/sandbox',
  timeout: 30_000,
  reporter: [['list']],
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});

// Playwright config for DVEA's Electron behavioral tests.
// No browser projects here — each test launches the real Electron app directly via the
// `_electron` API (see tests/*.spec.js) rather than driving a browser page.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  reporter: 'list',
});

import { defineConfig, devices } from '@playwright/test'

// Deliberately not a common dev-server default (3000/5173/4173/8080): with
// reuseExistingServer those ports let the suite silently test whatever other
// project happens to be running.
const PORT = Number(process.env.PORT || 4319)

export default defineConfig({
  testDir: './tests',
  // Opening a file pulls ~1.7 MB of vendored grid off the test server, and the
  // offline specs wait on service worker installs, so keep the budget generous
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Service worker registration and cache writes are the flaky part now that
  // nothing is fetched from a third party
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],

  webServer: {
    command: `bun tests/serve.mjs`,
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/`,
    // Never adopt a server this suite did not start. Failing loudly on a busy
    // port beats testing someone else's site and reporting nonsense.
    reuseExistingServer: false,
    timeout: 20_000
  }
})

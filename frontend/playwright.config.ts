import { defineConfig, devices } from '@playwright/test'

const PORT = 4310
const ORIGIN = `http://127.0.0.1:${PORT}`

// Builds the static site against the fake backend's origin, then serves both from e2e/fake-backend.ts.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: ORIGIN, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
  webServer: {
    command: `NEXT_PUBLIC_API_URL=${ORIGIN} NEXT_PUBLIC_STREAM_URL=${ORIGIN} npx next build && npx tsx e2e/fake-backend.ts`,
    url: ORIGIN,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { E2E_PORT: String(PORT) },
  },
})

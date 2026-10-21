import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['cdk.out/**', 'node_modules/**'],
    // CDK synthesis in beforeAll can take a few seconds on CI runners.
    hookTimeout: 60_000,
  },
})

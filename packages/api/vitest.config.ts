import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks', // Avoid tinypool "Worker exited unexpectedly" with Node 25
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/__tests__/**',
        '**/vitest.config.ts',
        '**/tsup.config.ts',
        '**/*.d.ts',
        // Infrastructure / entry - better covered by integration tests
        '**/index.ts',
        '**/instrumentation.ts',
        '**/server.ts',
        '**/routes/webhooks/**',
      ],
      // Unit tests cover auth, routes, and services; most code paths need Redis/DB (integration).
      // Thresholds set to 0 so coverage report is generated without blocking the build.
      thresholds: {
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})

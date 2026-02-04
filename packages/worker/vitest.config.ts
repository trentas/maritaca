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
        // Infrastructure files - hard to unit test, better covered by integration tests
        '**/index.ts',
        '**/worker.ts',
        '**/instrumentation.ts',
        '**/queues/**',
        '**/processors/**',
        '**/services/**',
        '**/registry.ts',
      ],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})

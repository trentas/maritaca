import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
        // Re-export and type-only files
        '**/index.ts',
        '**/types/**',
        '**/providers/base.ts',
        '**/providers/types.ts',
        // Infrastructure files
        '**/db/client.ts',
        '**/redis/**',
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

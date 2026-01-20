import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [
    '@maritaca/core',
    'fastify',
    '@fastify/env',
    'bullmq',
    'ioredis',
    'bcrypt',
    'drizzle-orm',
    '@paralleldrive/cuid2',
    'postgres',
  ],
})

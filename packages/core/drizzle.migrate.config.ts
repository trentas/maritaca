/**
 * Minimal config for running migrations only (e.g. in Docker/production).
 * Use: npx drizzle-kit migrate --config=drizzle.migrate.config.ts
 * Schema is not required for the migrate command.
 */
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
})

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

// Load .env from repo root (monorepo) or cwd so PORT, HOST, LOG_LEVEL, etc. are applied.
// override: true so .env wins over existing env vars (e.g. LOG_LEVEL=debug in .env overrides shell).
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, '../../.env')
loadEnv({ path: envPath, override: true })
loadEnv({ override: true }) // also .env in cwd

import './instrumentation.js'
import { startServer } from './server.js'
import { createLogger } from '@maritaca/core'

const logger = await createLogger({
  serviceName: 'maritaca-api',
  level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
})

const port = parseInt(process.env.PORT || '7377', 10)
const host = process.env.HOST || '0.0.0.0'
const databaseUrl = process.env.DATABASE_URL || ''
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

if (!databaseUrl) {
  logger.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

startServer({
  port,
  host,
  databaseUrl,
  redisUrl,
  logger,
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
}).catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})

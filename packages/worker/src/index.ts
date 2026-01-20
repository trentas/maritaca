import './instrumentation.js'
import { startWorker } from './worker.js'
import { createLogger } from '@maritaca/core'

const logger = await createLogger({
  serviceName: 'maritaca-worker',
  level: process.env.LOG_LEVEL || 'info',
})

const databaseUrl = process.env.DATABASE_URL || ''
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

if (!databaseUrl) {
  logger.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

await startWorker({
  databaseUrl,
  redisUrl,
  logger,
})

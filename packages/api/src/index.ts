import './instrumentation.js'
import { startServer } from './server.js'
import { createLogger } from '@maritaca/core'

const logger = await createLogger({
  serviceName: 'maritaca-api',
  level: process.env.LOG_LEVEL || 'info',
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
}).catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})

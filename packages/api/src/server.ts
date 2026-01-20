import Fastify, { FastifyInstance } from 'fastify'
import { createDbClient, createLogger, type DbClient } from '@maritaca/core'
import { messageRoutes } from './routes/messages.js'
import { authMiddleware } from './middleware/auth.js'
import { createQueue } from './services/queue.js'

export interface ServerOptions {
  port?: number
  host?: string
  databaseUrl: string
  redisUrl: string
}

/**
 * Create and configure Fastify server instance
 */
export async function createServer(options: ServerOptions): Promise<FastifyInstance> {
  const logger = await createLogger({
    serviceName: 'maritaca-api',
    level: process.env.LOG_LEVEL || 'info',
  })
  const server = Fastify({ logger })

  // Register environment variables
  await server.register(import('@fastify/env'), {
    schema: {
      type: 'object',
      required: [],
      properties: {
        PORT: { type: 'number', default: 7377 },
        HOST: { type: 'string', default: '0.0.0.0' },
        DATABASE_URL: { type: 'string' },
        REDIS_URL: { type: 'string' },
      },
    },
  })

  // Create database client
  const db = createDbClient(options.databaseUrl)
  server.decorate('db', db)

  // Create queue client
  const queue = createQueue(options.redisUrl)
  server.decorate('queue', queue)

  // Register authentication middleware
  await server.register(authMiddleware)

  // Register routes
  await server.register(messageRoutes, { prefix: '/v1' })

  // Health check endpoint
  server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  return server
}

declare module 'fastify' {
  interface FastifyInstance {
    db: DbClient
    queue: ReturnType<typeof createQueue>
  }
}

/**
 * Start the server
 */
export async function startServer(options: ServerOptions): Promise<void> {
  const server = await createServer(options)

  try {
    const address = await server.listen({
      port: options.port || 7377,
      host: options.host || '0.0.0.0',
    })
    server.log.info(`Server listening on ${address}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

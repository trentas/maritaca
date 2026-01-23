import Fastify, { FastifyInstance } from 'fastify'
import fastifyRateLimit from '@fastify/rate-limit'
import { sql } from 'drizzle-orm'
import { createDbClient, createLogger, parseRedisUrl, type DbClient } from '@maritaca/core'
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
 * Rate limit configuration from environment variables
 */
function getRateLimitConfig() {
  return {
    // Maximum requests per time window (default: 100)
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    // Time window in milliseconds (default: 1 minute)
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  }
}

/**
 * Create and configure Fastify server instance
 */
export async function createServer(options: ServerOptions): Promise<FastifyInstance> {
  const logger = await createLogger({
    serviceName: 'maritaca-api',
    level: process.env.LOG_LEVEL || 'info',
  })
  const server = Fastify({ logger: logger as any })

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
        RATE_LIMIT_MAX: { type: 'number', default: 100 },
        RATE_LIMIT_WINDOW_MS: { type: 'number', default: 60000 },
      },
    },
  })

  // Create database client
  const db = createDbClient(options.databaseUrl)
  server.decorate('db', db)

  // Create queue client
  const queue = createQueue(options.redisUrl)
  server.decorate('queue', queue)

  // Register rate limiting with Redis store for distributed rate limiting
  const rateLimitConfig = getRateLimitConfig()
  const redisConnection = parseRedisUrl(options.redisUrl)
  
  await server.register(fastifyRateLimit, {
    max: rateLimitConfig.max,
    timeWindow: rateLimitConfig.timeWindow,
    // Use Redis for distributed rate limiting across multiple instances
    redis: {
      host: redisConnection.host,
      port: redisConnection.port,
      password: redisConnection.password,
      db: redisConnection.db,
    },
    // Use projectId as the key for rate limiting (after auth middleware runs)
    keyGenerator: (request) => {
      // Use projectId if available (authenticated requests)
      // Fall back to IP for unauthenticated requests (e.g., before auth fails)
      return request.projectId || request.ip
    },
    // Skip rate limiting for health check
    allowList: (request) => {
      return request.url === '/health'
    },
    // Custom error response
    errorResponseBuilder: (request, context) => {
      return {
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
        retryAfter: Math.ceil(context.ttl / 1000),
      }
    },
    // Add rate limit headers to responses
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  })

  // Register authentication middleware
  await server.register(authMiddleware)

  // Register routes
  await server.register(messageRoutes, { prefix: '/v1' })

  // Health check endpoint
  // Tests database and Redis connectivity for readiness
  server.get('/health', async (request, reply) => {
    const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; error?: string }> = {}
    let healthy = true

    // Check PostgreSQL
    const dbStart = Date.now()
    try {
      await db.execute(sql`SELECT 1`)
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart }
    } catch (err: any) {
      healthy = false
      checks.database = { status: 'error', latencyMs: Date.now() - dbStart, error: err.message }
    }

    // Check Redis via BullMQ queue client
    const redisStart = Date.now()
    try {
      const client = await queue.client
      await client.ping()
      checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart }
    } catch (err: any) {
      healthy = false
      checks.redis = { status: 'error', latencyMs: Date.now() - redisStart, error: err.message }
    }

    const response = {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    }

    return reply.code(healthy ? 200 : 503).send(response)
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

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    server.log.info({ signal }, 'Graceful shutdown initiated...')
    
    try {
      // Close Fastify server (stops accepting new connections)
      await server.close()
      
      // Close queue client (Redis connection)
      await server.queue.close()
      
      // Close database connection pool
      await server.db.close()
      
      server.log.info('Shutdown complete')
      process.exit(0)
    } catch (err) {
      server.log.error(err, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

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

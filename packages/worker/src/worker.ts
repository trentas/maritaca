import { trace } from '@opentelemetry/api'
import { Worker } from 'bullmq'
import { createDbClient, createLogger, parseRedisUrl, type Logger } from '@maritaca/core'
import { processMessageJob } from './processors/message.js'

export interface WorkerOptions {
  databaseUrl: string
  redisUrl: string
  logger?: Logger
}

/**
 * Create and start BullMQ worker
 */
export async function createWorker(options: WorkerOptions): Promise<Worker> {
  const logger = options.logger ?? await createLogger({ serviceName: 'maritaca-worker' })
  
  const connection = parseRedisUrl(options.redisUrl)

  const db = createDbClient(options.databaseUrl)

  const worker = new Worker('maritaca-notifications', async (job) => {
    return processMessageJob(db, job.data, logger)
  }, {
    connection,
    concurrency: 10,
    removeOnComplete: {
      count: 1000,
      age: 24 * 3600, // 24 hours
    },
    removeOnFail: {
      count: 5000,
      age: 7 * 24 * 3600, // 7 days
    },
  })

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Job completed')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job failed')
  })

  return worker
}

/**
 * Start the worker
 */
export async function startWorker(options: WorkerOptions): Promise<void> {
  const logger = options.logger ?? await createLogger({ serviceName: 'maritaca-worker' })
  const worker = await createWorker({ ...options, logger })

  logger.info('Worker started and listening for jobs')

  // Ensures at least one span so the worker service appears in observability platforms (e.g. when no jobs processed yet)
  trace.getTracer('maritaca-worker', '1.0').startSpan('worker.ready').end()

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down worker...')
    await worker.close()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down worker...')
    await worker.close()
    process.exit(0)
  })
}

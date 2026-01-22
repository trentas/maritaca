import { trace } from '@opentelemetry/api'
import { Worker } from 'bullmq'
import { createDbClient, createLogger, parseRedisUrl, type Logger } from '@maritaca/core'
import { processMessageJob } from './processors/message.js'
import { processMaintenanceJob, type MaintenanceJobData } from './processors/maintenance.js'
import { createMaintenanceQueue, scheduleMaintenanceJobs, MAINTENANCE_QUEUE_NAME } from './queues/maintenance.js'

export interface WorkerOptions {
  databaseUrl: string
  redisUrl: string
  logger?: Logger
  /** Enable maintenance worker (default: true) */
  enableMaintenance?: boolean
  /** Schedule recurring maintenance jobs on startup (default: true) */
  scheduleMaintenance?: boolean
}

/**
 * Workers result
 */
export interface Workers {
  notificationWorker: Worker
  maintenanceWorker?: Worker
}

/**
 * Create and start BullMQ workers
 */
export async function createWorker(options: WorkerOptions): Promise<Workers> {
  const logger = options.logger ?? await createLogger({ serviceName: 'maritaca-worker' })
  const { enableMaintenance = true, scheduleMaintenance = true } = options
  
  const connection = parseRedisUrl(options.redisUrl)

  const db = createDbClient(options.databaseUrl)

  // Notification worker
  const notificationWorker = new Worker('maritaca-notifications', async (job) => {
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

  notificationWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, queue: 'notifications' }, 'Job completed')
  })

  notificationWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, queue: 'notifications', err }, 'Job failed')
  })

  // Maintenance worker (optional)
  let maintenanceWorker: Worker | undefined

  if (enableMaintenance) {
    maintenanceWorker = new Worker<MaintenanceJobData>(
      MAINTENANCE_QUEUE_NAME,
      async (job) => {
        return processMaintenanceJob(db, job.data, logger)
      },
      {
        connection,
        concurrency: 1, // Run one maintenance job at a time
        removeOnComplete: {
          count: 100,
          age: 7 * 24 * 3600, // 7 days
        },
        removeOnFail: {
          count: 500,
          age: 30 * 24 * 3600, // 30 days
        },
      },
    )

    maintenanceWorker.on('completed', (job) => {
      logger.info({ jobId: job.id, queue: 'maintenance', type: job.data.type }, 'Maintenance job completed')
    })

    maintenanceWorker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, queue: 'maintenance', type: job?.data?.type, err }, 'Maintenance job failed')
    })

    // Schedule recurring maintenance jobs
    if (scheduleMaintenance) {
      const maintenanceQueue = createMaintenanceQueue(connection)
      await scheduleMaintenanceJobs(maintenanceQueue)
      logger.info('Scheduled recurring maintenance jobs')
      await maintenanceQueue.close()
    }
  }

  return { notificationWorker, maintenanceWorker }
}

/**
 * Start the worker
 */
export async function startWorker(options: WorkerOptions): Promise<void> {
  const logger = options.logger ?? await createLogger({ serviceName: 'maritaca-worker' })
  const { notificationWorker, maintenanceWorker } = await createWorker({ ...options, logger })

  logger.info({
    maintenance: !!maintenanceWorker,
  }, 'Worker started and listening for jobs')

  // Ensures at least one span so the worker service appears in observability platforms (e.g. when no jobs processed yet)
  trace.getTracer('maritaca-worker', '1.0').startSpan('worker.ready').end()

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down workers...')
    await notificationWorker.close()
    if (maintenanceWorker) {
      await maintenanceWorker.close()
    }
    process.exit(0)
  }

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received')
    await shutdown()
  })

  process.on('SIGINT', async () => {
    logger.info('SIGINT received')
    await shutdown()
  })
}

import { Queue } from 'bullmq'
import type { RedisConnectionConfig } from '@maritaca/core'
import type { MaintenanceJobData } from '../processors/maintenance.js'

/**
 * Maintenance queue for scheduled jobs
 */
export const MAINTENANCE_QUEUE_NAME = 'maritaca-maintenance'

/**
 * Create the maintenance queue
 */
export function createMaintenanceQueue(connection: RedisConnectionConfig): Queue<MaintenanceJobData> {
  return new Queue<MaintenanceJobData>(MAINTENANCE_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000, // 1 minute
      },
      removeOnComplete: {
        count: 100,
        age: 7 * 24 * 3600, // 7 days
      },
      removeOnFail: {
        count: 500,
        age: 30 * 24 * 3600, // 30 days
      },
    },
  })
}

/**
 * Schedule recurring maintenance jobs
 * 
 * @param queue - Maintenance queue
 * @param options - Scheduling options
 */
export async function scheduleMaintenanceJobs(
  queue: Queue<MaintenanceJobData>,
  options?: {
    /** Cron pattern for partition maintenance (default: daily at 3 AM) */
    partitionMaintenanceCron?: string
    /** Number of months ahead to create partitions (default: 3) */
    monthsAhead?: number
    /** Number of months to retain partitions (default: 12) */
    retentionMonths?: number
  },
): Promise<void> {
  const {
    partitionMaintenanceCron = process.env.AUDIT_MAINTENANCE_CRON || '0 3 * * *', // 3:00 AM every day
    monthsAhead = parseInt(process.env.AUDIT_PARTITION_MONTHS_AHEAD || '3'),
    retentionMonths = parseInt(process.env.AUDIT_RETENTION_MONTHS || '12'),
  } = options ?? {}

  // Remove existing repeatable jobs to avoid duplicates
  const existingJobs = await queue.getRepeatableJobs()
  for (const job of existingJobs) {
    if (job.name === 'partition-maintenance') {
      await queue.removeRepeatableByKey(job.key)
    }
  }

  // Schedule partition maintenance
  await queue.add(
    'partition-maintenance',
    {
      type: 'partition-maintenance',
      monthsAhead,
      retentionMonths,
    },
    {
      repeat: {
        pattern: partitionMaintenanceCron,
      },
      jobId: 'partition-maintenance-scheduled',
    },
  )
}

/**
 * Trigger immediate partition maintenance (useful for testing or manual runs)
 */
export async function triggerPartitionMaintenance(
  queue: Queue<MaintenanceJobData>,
  options?: {
    monthsAhead?: number
    retentionMonths?: number
  },
): Promise<string> {
  const job = await queue.add(
    'partition-maintenance-manual',
    {
      type: 'partition-maintenance',
      monthsAhead: options?.monthsAhead ?? 3,
      retentionMonths: options?.retentionMonths ?? 12,
    },
    {
      jobId: `partition-maintenance-manual-${Date.now()}`,
    },
  )

  return job.id!
}

/**
 * Get partition statistics (useful for monitoring dashboards)
 */
export async function getPartitionStatsJob(
  queue: Queue<MaintenanceJobData>,
): Promise<string> {
  const job = await queue.add(
    'partition-stats',
    {
      type: 'partition-stats',
    },
    {
      jobId: `partition-stats-${Date.now()}`,
    },
  )

  return job.id!
}

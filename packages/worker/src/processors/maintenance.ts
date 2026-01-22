import { trace, SpanStatusCode } from '@opentelemetry/api'
import type { DbClient, Logger } from '@maritaca/core'
import { ensurePartitions, dropOldPartitions, getPartitionStats } from '@maritaca/core'

const tracer = trace.getTracer('maritaca-worker', '1.0')

/**
 * Maintenance job types
 */
export type MaintenanceJobType = 'partition-maintenance' | 'partition-stats'

/**
 * Maintenance job data
 */
export interface MaintenanceJobData {
  type: MaintenanceJobType
  /** Number of months ahead to create partitions (default: 3) */
  monthsAhead?: number
  /** Number of months to retain partitions (default: 12) */
  retentionMonths?: number
}

/**
 * Maintenance job result
 */
export interface MaintenanceJobResult {
  type: MaintenanceJobType
  createdPartitions?: string[]
  droppedPartitions?: string[]
  stats?: {
    partitions: Array<{ name: string; rowCount: number; sizeBytes: number }>
    totalRows: number
    totalSizeBytes: number
  }
}

/**
 * Process maintenance jobs
 * 
 * Handles:
 * - partition-maintenance: Create future partitions, drop old ones
 * - partition-stats: Get partition statistics (for monitoring)
 */
export async function processMaintenanceJob(
  db: DbClient,
  jobData: MaintenanceJobData,
  logger: Logger,
): Promise<MaintenanceJobResult> {
  const { type, monthsAhead = 3, retentionMonths = 12 } = jobData

  return tracer.startActiveSpan(`maintenance.${type}`, async (span) => {
    span.setAttribute('job.type', type)
    span.setAttribute('monthsAhead', monthsAhead)
    span.setAttribute('retentionMonths', retentionMonths)

    try {
      switch (type) {
        case 'partition-maintenance': {
          logger.info({ monthsAhead, retentionMonths }, 'Running partition maintenance')

          // Create future partitions
          const createdPartitions = await ensurePartitions(db, monthsAhead)
          logger.info({ created: createdPartitions.length }, 'Created partitions')

          // Drop old partitions
          const droppedPartitions = await dropOldPartitions(db, retentionMonths)
          logger.info({ dropped: droppedPartitions.length }, 'Dropped old partitions')

          span.setAttribute('partitions.created', createdPartitions.length)
          span.setAttribute('partitions.dropped', droppedPartitions.length)
          span.setStatus({ code: SpanStatusCode.OK })
          span.end()

          return {
            type,
            createdPartitions,
            droppedPartitions,
          }
        }

        case 'partition-stats': {
          logger.info('Getting partition statistics')

          const stats = await getPartitionStats(db)
          
          logger.info({
            partitionCount: stats.partitions.length,
            totalRows: stats.totalRows,
            totalSizeMB: Math.round(stats.totalSizeBytes / 1024 / 1024),
          }, 'Partition statistics')

          span.setAttribute('partitions.count', stats.partitions.length)
          span.setAttribute('partitions.totalRows', stats.totalRows)
          span.setAttribute('partitions.totalSizeBytes', stats.totalSizeBytes)
          span.setStatus({ code: SpanStatusCode.OK })
          span.end()

          return {
            type,
            stats,
          }
        }

        default:
          throw new Error(`Unknown maintenance job type: ${type}`)
      }
    } catch (error: any) {
      logger.error({ err: error, type }, 'Maintenance job failed')
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      span.recordException(error)
      span.end()
      throw error
    }
  })
}

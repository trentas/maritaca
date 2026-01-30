#!/usr/bin/env node
/**
 * Enqueue a partition maintenance job so the worker runs it.
 * The worker must be running to process the job.
 *
 * Usage: REDIS_URL=redis://localhost:6379 pnpm exec tsx scripts/trigger-maintenance.ts
 *   Or:  pnpm trigger-maintenance
 *
 * Set OTEL_EXPORTER_OTLP_ENDPOINT to export traces (e.g. http://localhost:4318).
 */

import { trace } from '@opentelemetry/api'
import { initOtel, shutdownOtel } from './instrumentation.js'
import { parseRedisUrl } from '../packages/core/src/redis/index.js'
import {
  createMaintenanceQueue,
  triggerPartitionMaintenance,
} from '../packages/worker/src/queues/maintenance.js'

const tracer = trace.getTracer('maritaca-scripts', '1.0')

async function main() {
  await initOtel()

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
  const connection = parseRedisUrl(redisUrl)
  const queue = createMaintenanceQueue(connection)

  return tracer.startActiveSpan('trigger-maintenance', async (span) => {
    try {
      const jobId = await triggerPartitionMaintenance(queue, {
        monthsAhead: parseInt(process.env.AUDIT_PARTITION_MONTHS_AHEAD || '3'),
        retentionMonths: parseInt(process.env.AUDIT_RETENTION_MONTHS || '12'),
      })
      span.setAttribute('maintenance.job_id', jobId)
      console.log('Maintenance job enqueued. Job ID:', jobId)
      console.log('Ensure the worker is running to process it.')
      await queue.close()
      return 0
    } finally {
      span.end()
    }
  })
}

main()
  .then(async (code) => {
    await shutdownOtel()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error('Failed to enqueue maintenance job:', err)
    await shutdownOtel()
    process.exit(1)
  })

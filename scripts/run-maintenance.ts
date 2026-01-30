#!/usr/bin/env node
/**
 * Run partition maintenance directly (no Redis/worker).
 * Creates future audit_logs partitions and drops old ones.
 *
 * Usage: DATABASE_URL=... pnpm exec tsx scripts/run-maintenance.ts
 *   Or:  pnpm run-maintenance
 *
 * Set OTEL_EXPORTER_OTLP_ENDPOINT to export traces (e.g. http://localhost:4318).
 */

import { initOtel, shutdownOtel } from './instrumentation.js'
import { createDbClient } from '../packages/core/src/db/client.js'
import { createLogger } from '../packages/core/src/logger/index.js'
import { processMaintenanceJob } from '../packages/worker/src/processors/maintenance.js'

const databaseUrl = process.env.DATABASE_URL || ''
const monthsAhead = parseInt(process.env.AUDIT_PARTITION_MONTHS_AHEAD || '3', 10)
const retentionMonths = parseInt(process.env.AUDIT_RETENTION_MONTHS || '12', 10)

if (!databaseUrl) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

async function main() {
  await initOtel()

  const logger = await createLogger({
    serviceName: 'maritaca-run-maintenance',
    level: process.env.LOG_LEVEL || 'info',
  })

  const db = createDbClient(databaseUrl)

  const result = await processMaintenanceJob(
    db,
    {
      type: 'partition-maintenance',
      monthsAhead,
      retentionMonths,
    },
    logger,
  )

  console.log('Result:', result)
  await db.close()
  return 0
}

main()
  .then(async (code) => {
    await shutdownOtel()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error('Maintenance failed:', err)
    await shutdownOtel()
    process.exit(1)
  })

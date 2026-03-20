#!/usr/bin/env node
/**
 * Inspect BullMQ queues to see what jobs are pending, delayed, failed, etc.
 *
 * Usage: REDIS_URL=redis://localhost:6379 pnpm exec tsx scripts/inspect-queue.ts
 *   Or:  pnpm inspect-queue
 *
 * Options (env vars):
 *   SHOW_DATA=1       Show full job data payload
 *   LIMIT=50          Max jobs to show per state (default: 20)
 */

import { Queue } from 'bullmq'
import { parseRedisUrl } from '../packages/core/src/redis/index.js'

const NOTIFICATION_QUEUE = 'maritaca-notifications'
const MAINTENANCE_QUEUE = 'maritaca-maintenance'

const showData = process.env.SHOW_DATA === '1'
const limit = parseInt(process.env.LIMIT || '20', 10)

interface JobSummary {
  id: string | undefined
  name: string
  attemptsMade: number
  maxAttempts: number
  delay: number
  timestamp: string
  processedOn: string | null
  finishedOn: string | null
  failedReason: string | undefined
  data?: unknown
}

function formatDate(ms: number | undefined): string | null {
  if (!ms) return null
  return new Date(ms).toISOString()
}

function summarizeJob(job: {
  id?: string
  name: string
  attemptsMade: number
  opts: { attempts?: number; delay?: number }
  timestamp: number
  processedOn?: number
  finishedOn?: number
  failedReason?: string
  data: unknown
}): JobSummary {
  const summary: JobSummary = {
    id: job.id,
    name: job.name,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? 3,
    delay: job.opts.delay ?? 0,
    timestamp: new Date(job.timestamp).toISOString(),
    processedOn: formatDate(job.processedOn),
    finishedOn: formatDate(job.finishedOn),
    failedReason: job.failedReason,
  }
  if (showData) {
    summary.data = job.data
  }
  return summary
}

async function inspectQueue(name: string, connection: ReturnType<typeof parseRedisUrl>) {
  const queue = new Queue(name, { connection })

  console.log(`\n${'='.repeat(60)}`)
  console.log(`  Queue: ${name}`)
  console.log('='.repeat(60))

  // Get counts for all states
  const counts = await queue.getJobCounts(
    'wait',
    'active',
    'delayed',
    'failed',
    'completed',
    'paused',
    'prioritized',
  )

  console.log('\n  Job counts:')
  for (const [state, count] of Object.entries(counts)) {
    const marker = count > 0 && state !== 'completed' ? ' <<<' : ''
    console.log(`    ${state.padEnd(14)} ${count}${marker}`)
  }

  // Show repeatable (cron) jobs
  const repeatableJobs = await queue.getRepeatableJobs()
  if (repeatableJobs.length > 0) {
    console.log(`\n  Repeatable (cron) jobs: ${repeatableJobs.length}`)
    for (const rj of repeatableJobs) {
      console.log(`    - ${rj.name}  pattern: ${rj.pattern}  next: ${formatDate(rj.next)}`)
    }
  }

  // Show details for non-empty interesting states
  const statesToInspect = ['delayed', 'wait', 'active', 'failed', 'paused', 'prioritized'] as const

  for (const state of statesToInspect) {
    if (counts[state] === 0) continue

    const jobs = await queue.getJobs([state], 0, limit - 1)

    console.log(`\n  --- ${state.toUpperCase()} jobs (showing ${Math.min(jobs.length, limit)} of ${counts[state]}) ---`)

    for (const job of jobs) {
      const s = summarizeJob(job)
      console.log(`\n    Job #${s.id} [${s.name}]`)
      console.log(`      created:    ${s.timestamp}`)
      if (s.delay > 0) console.log(`      delay:      ${s.delay}ms (${Math.round(s.delay / 60_000)}min)`)
      if (s.processedOn) console.log(`      processed:  ${s.processedOn}`)
      if (s.finishedOn) console.log(`      finished:   ${s.finishedOn}`)
      console.log(`      attempts:   ${s.attemptsMade}/${s.maxAttempts}`)
      if (s.failedReason) console.log(`      error:      ${s.failedReason}`)
      if (s.data) console.log(`      data:       ${JSON.stringify(s.data, null, 2)}`)
    }
  }

  await queue.close()
}

async function main() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
  const connection = parseRedisUrl(redisUrl)

  console.log(`Connecting to Redis: ${redisUrl.replace(/\/\/.*:.*@/, '//*****@')}`)
  console.log(`Limit: ${limit} jobs per state | Show data: ${showData}`)

  await inspectQueue(NOTIFICATION_QUEUE, connection)
  await inspectQueue(MAINTENANCE_QUEUE, connection)

  console.log('\nDone.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to inspect queues:', err)
    process.exit(1)
  })

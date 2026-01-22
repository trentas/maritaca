import { Queue, JobsOptions } from 'bullmq'
import { parseRedisUrl, type Envelope } from '@maritaca/core'

export interface QueueJobData {
  messageId: string
  channel: string
  envelope: Envelope
}

/**
 * Create BullMQ queue client
 */
export function createQueue(redisUrl: string): Queue<QueueJobData> {
  const connection = parseRedisUrl(redisUrl)

  return new Queue<QueueJobData>('maritaca-notifications', {
    connection,
  })
}

/**
 * Calculate delay in milliseconds for scheduled messages
 * Returns 0 if scheduleAt is in the past or not specified
 */
function calculateDelay(scheduleAt?: Date): number {
  if (!scheduleAt) {
    return 0
  }

  const now = Date.now()
  const scheduledTime = new Date(scheduleAt).getTime()
  const delay = scheduledTime - now

  // If scheduled time is in the past, process immediately
  return delay > 0 ? delay : 0
}

/**
 * Get job priority based on envelope priority
 * BullMQ uses lower numbers for higher priority
 */
function getJobPriority(priority?: 'low' | 'normal' | 'high'): number {
  switch (priority) {
    case 'high':
      return 1
    case 'low':
      return 10
    case 'normal':
    default:
      return 5
  }
}

/**
 * Enqueue message for processing by channel
 * Supports scheduled messages via envelope.scheduleAt
 * Supports priority via envelope.priority
 */
export async function enqueueMessage(
  queue: Queue<QueueJobData>,
  messageId: string,
  envelope: Envelope,
): Promise<void> {
  const delay = calculateDelay(envelope.scheduleAt)
  const priority = getJobPriority(envelope.priority)

  // Base job options
  const jobOptions: JobsOptions = {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    priority,
  }

  // Add delay for scheduled messages
  if (delay > 0) {
    jobOptions.delay = delay
  }

  // Create a job for each channel
  const jobs = envelope.channels.map((channel) =>
    queue.add(
      `channel-${channel}`,
      {
        messageId,
        channel,
        envelope,
      },
      jobOptions,
    ),
  )

  await Promise.all(jobs)
}

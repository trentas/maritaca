import { Queue, QueueOptions } from 'bullmq'
import type { Envelope } from '@maritaca/core'

export interface QueueJobData {
  messageId: string
  channel: string
  envelope: Envelope
}

/**
 * Create BullMQ queue client
 */
export function createQueue(redisUrl: string): Queue<QueueJobData> {
  const url = new URL(redisUrl)
  const connection: QueueOptions['connection'] = {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
  }

  // Add password if present
  if (url.password) {
    connection.password = url.password
  }

  return new Queue<QueueJobData>('maritaca-notifications', {
    connection,
  })
}

/**
 * Enqueue message for processing by channel
 */
export async function enqueueMessage(
  queue: Queue<QueueJobData>,
  messageId: string,
  envelope: Envelope,
): Promise<void> {
  // Create a job for each channel
  const jobs = envelope.channels.map((channel) =>
    queue.add(
      `channel-${channel}`,
      {
        messageId,
        channel,
        envelope,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    ),
  )

  await Promise.all(jobs)
}

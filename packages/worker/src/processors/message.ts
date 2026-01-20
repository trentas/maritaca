import { eq } from 'drizzle-orm'
import { messages, attempts, events, type DbClient, type Logger } from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'
import { SlackProvider } from '../providers/slack.js'
import { EmailProvider } from '../providers/email.js'
import type { Envelope, Channel } from '@maritaca/core'

export interface MessageJobData {
  messageId: string
  channel: Channel
  envelope: Envelope
}

/**
 * Process a message job for a specific channel
 */
export async function processMessageJob(
  db: DbClient,
  jobData: MessageJobData,
  logger: Logger,
): Promise<void> {
  const { messageId, channel, envelope } = jobData
  
  const jobLogger = logger.child({ messageId, channel })
  
  jobLogger.debug('Processing message job')

  // Get provider for channel
  const provider = getProviderForChannel(channel, jobLogger)

  if (!provider) {
    jobLogger.error({ channel }, 'No provider found for channel')
    throw new Error(`No provider found for channel: ${channel}`)
  }

  // Validate envelope
  provider.validate(envelope)

  // Create attempt record
  const attemptId = createId()
  await db.insert(attempts).values({
    id: attemptId,
    messageId,
    channel,
    provider: provider.channel,
    status: 'pending',
  })

  // Emit attempt.started event
  await db.insert(events).values({
    id: createId(),
    messageId,
    type: 'attempt.started',
    channel,
    provider: provider.channel,
  })

  // Update attempt status to started
  await db
    .update(attempts)
    .set({
      status: 'started',
      startedAt: new Date(),
    })
    .where(eq(attempts.id, attemptId))

  try {
    // Prepare message
    const prepared = provider.prepare(envelope)

    // Send message
    const response = await provider.send(prepared)

    // Map response to events
    const providerEvents = provider.mapEvents(response, messageId)

    // Persist events
    for (const event of providerEvents) {
      await db.insert(events).values({
        id: event.id,
        messageId: event.messageId,
        type: event.type,
        channel: event.channel,
        provider: event.provider,
        payload: event.payload,
        createdAt: event.timestamp,
      })
    }

    // Update attempt
    await db
      .update(attempts)
      .set({
        status: response.success ? 'succeeded' : 'failed',
        error: response.error ? JSON.stringify(response.error) : null,
        finishedAt: new Date(),
      })
      .where(eq(attempts.id, attemptId))

    // Check if all channels are done and update message status
    await updateMessageStatus(db, messageId, jobLogger)
    
    jobLogger.info({ attemptId, success: response.success }, 'Message processed successfully')
  } catch (error: any) {
    jobLogger.error({ attemptId, err: error }, 'Failed to process message job')
    
    // Update attempt with error
    await db
      .update(attempts)
      .set({
        status: 'failed',
        error: error.message || String(error),
        finishedAt: new Date(),
      })
      .where(eq(attempts.id, attemptId))

    // Emit attempt.failed event
    await db.insert(events).values({
      id: createId(),
      messageId,
      type: 'attempt.failed',
      channel,
      provider: provider.channel,
      payload: {
        error: error.message || String(error),
      },
    })

    // Update message status
    await updateMessageStatus(db, messageId, jobLogger)

    throw error
  }
}

/**
 * Get provider instance for a channel
 */
function getProviderForChannel(channel: Channel, logger?: Logger) {
  switch (channel) {
    case 'slack':
      return new SlackProvider()
    case 'email':
      return new EmailProvider(logger)
    default:
      return null
  }
}

/**
 * Update message status based on attempt results
 */
async function updateMessageStatus(
  db: DbClient,
  messageId: string,
  logger: Logger,
): Promise<void> {
  // Get all attempts for this message
  const messageAttempts = await db
    .select()
    .from(attempts)
    .where(eq(attempts.messageId, messageId))

  const total = messageAttempts.length
  const succeeded = messageAttempts.filter((a) => a.status === 'succeeded').length
  const failed = messageAttempts.filter((a) => a.status === 'failed').length

  let status: 'pending' | 'queued' | 'processing' | 'delivered' | 'failed' | 'partially_delivered'

  if (succeeded === total) {
    status = 'delivered'
    // Emit message.delivered event
    await db.insert(events).values({
      id: createId(),
      messageId,
      type: 'message.delivered',
    })
  } else if (failed === total) {
    status = 'failed'
    // Emit message.failed event
    await db.insert(events).values({
      id: createId(),
      messageId,
      type: 'message.failed',
    })
  } else if (succeeded > 0) {
    status = 'partially_delivered'
  } else {
    status = 'processing'
  }

  // Update message status
  await db
    .update(messages)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(messages.id, messageId))
}

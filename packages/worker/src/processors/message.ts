import { eq } from 'drizzle-orm'
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api'
import { messages, attempts, events, type DbClient, type Logger } from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'
import { providerRegistry } from '../providers/registry.js'
import type { Envelope, Channel } from '@maritaca/core'

const tracer = trace.getTracer('maritaca-worker', '1.0')

export interface MessageJobData {
  messageId: string
  channel: Channel
  envelope: Envelope
}

/**
 * Process a message job for a specific channel
 * Uses transactions to ensure consistency of database operations
 */
export async function processMessageJob(
  db: DbClient,
  jobData: MessageJobData,
  logger: Logger,
): Promise<void> {
  const { messageId, channel, envelope } = jobData
  
  const jobLogger = logger.child({ messageId, channel })

  // Create main span for the entire job processing
  return tracer.startActiveSpan('processMessageJob', {
    attributes: {
      'message.id': messageId,
      'message.channel': channel,
      'message.recipients': Array.isArray(envelope.recipient) 
        ? envelope.recipient.length 
        : 1,
    },
  }, async (span) => {
    try {
      jobLogger.debug('Processing message job')

      // Initialize provider registry with logger (idempotent)
      providerRegistry.initialize(jobLogger)

      // Get provider for channel (singleton instance)
      const provider = providerRegistry.getProvider(channel)

      if (!provider) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'No provider found' })
        jobLogger.error({ channel }, 'No provider found for channel')
        throw new Error(`No provider found for channel: ${channel}`)
      }

      span.setAttribute('provider.name', provider.channel)

      // Validate envelope
      await traceOperation(span, 'validate', async () => {
        provider.validate(envelope)
      })

      // Transaction 1: Create attempt and emit started event atomically
      const attemptId = createId()
      const startedAt = new Date()
      
      await traceOperation(span, 'createAttempt', async () => {
        await db.transaction(async (tx) => {
          await tx.insert(attempts).values({
            id: attemptId,
            messageId,
            channel,
            provider: provider.channel,
            status: 'started',
            startedAt,
          })

          await tx.insert(events).values({
            id: createId(),
            messageId,
            type: 'attempt.started',
            channel,
            provider: provider.channel,
          })
        })
      })

      span.setAttribute('attempt.id', attemptId)

      try {
        // Prepare message
        const prepared = await traceOperation(span, 'prepare', async () => {
          return provider.prepare(envelope)
        })

        // Send message (external I/O - most important to trace)
        const response = await traceOperation(span, 'send', async (sendSpan) => {
          const result = await provider.send(prepared)
          sendSpan.setAttribute('send.success', result.success)
          if (result.externalId) {
            sendSpan.setAttribute('send.externalId', result.externalId)
          }
          if (!result.success && result.error) {
            sendSpan.setAttribute('send.error.code', result.error.code || 'UNKNOWN')
            sendSpan.setAttribute('send.error.message', result.error.message || '')
          }
          return result
        })

        // Transaction 2: Persist result atomically
        await traceOperation(span, 'persistResult', async () => {
          await db.transaction(async (tx) => {
            const providerEvents = provider.mapEvents(response, messageId)
            
            if (providerEvents.length > 0) {
              await tx.insert(events).values(
                providerEvents.map((event) => ({
                  id: event.id,
                  messageId: event.messageId,
                  type: event.type,
                  channel: event.channel,
                  provider: event.provider,
                  payload: event.payload,
                  createdAt: event.timestamp,
                })),
              )
            }

            await tx
              .update(attempts)
              .set({
                status: response.success ? 'succeeded' : 'failed',
                error: response.error ? JSON.stringify(response.error) : null,
                finishedAt: new Date(),
              })
              .where(eq(attempts.id, attemptId))
          })
        })

        // Update message status
        await traceOperation(span, 'updateMessageStatus', async () => {
          await updateMessageStatus(db, messageId, jobLogger)
        })

        span.setAttribute('job.success', response.success)
        span.setStatus({ code: SpanStatusCode.OK })
        jobLogger.info({ attemptId, success: response.success }, 'Message processed successfully')
      } catch (error: any) {
        jobLogger.error({ attemptId, err: error }, 'Failed to process message job')
        
        // Transaction 3: Persist failure atomically
        await traceOperation(span, 'persistFailure', async () => {
          await db.transaction(async (tx) => {
            await tx
              .update(attempts)
              .set({
                status: 'failed',
                error: error.message || String(error),
                finishedAt: new Date(),
              })
              .where(eq(attempts.id, attemptId))

            await tx.insert(events).values({
              id: createId(),
              messageId,
              type: 'attempt.failed',
              channel,
              provider: provider.channel,
              payload: {
                error: error.message || String(error),
              },
            })
          })
        })

        // Update message status
        await traceOperation(span, 'updateMessageStatus', async () => {
          await updateMessageStatus(db, messageId, jobLogger)
        })

        throw error
      }
    } catch (error: any) {
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      throw error
    } finally {
      span.end()
    }
  })
}

/**
 * Helper to trace an operation as a child span
 */
async function traceOperation<T>(
  parentSpan: Span,
  operationName: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(operationName, async (span) => {
    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error: any) {
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      throw error
    } finally {
      span.end()
    }
  })
}

/**
 * Update message status based on attempt results
 * Uses a transaction with row-level lock to prevent race conditions
 */
async function updateMessageStatus(
  db: DbClient,
  messageId: string,
  logger: Logger,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Lock the message row to prevent concurrent updates
    const [lockedMessage] = await tx
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .for('update')

    if (!lockedMessage) {
      logger.warn({ messageId }, 'Message not found for status update')
      return
    }

    // Get all attempts for this message (within the same transaction)
    const messageAttempts = await tx
      .select()
      .from(attempts)
      .where(eq(attempts.messageId, messageId))

    const total = messageAttempts.length
    const succeeded = messageAttempts.filter((a) => a.status === 'succeeded').length
    const failed = messageAttempts.filter((a) => a.status === 'failed').length

    let status: 'pending' | 'queued' | 'processing' | 'delivered' | 'failed' | 'partially_delivered'
    let eventType: 'message.delivered' | 'message.failed' | null = null

    if (succeeded === total && total > 0) {
      status = 'delivered'
      // Only emit if status is changing
      if (lockedMessage.status !== 'delivered') {
        eventType = 'message.delivered'
      }
    } else if (failed === total && total > 0) {
      status = 'failed'
      // Only emit if status is changing
      if (lockedMessage.status !== 'failed') {
        eventType = 'message.failed'
      }
    } else if (succeeded > 0) {
      status = 'partially_delivered'
    } else {
      status = 'processing'
    }

    // Update message status
    await tx
      .update(messages)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, messageId))

    // Emit event if needed (within transaction to ensure consistency)
    if (eventType) {
      await tx.insert(events).values({
        id: createId(),
        messageId,
        type: eventType,
      })
    }
  })
}

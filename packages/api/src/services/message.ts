import { eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import type { Envelope } from '@maritaca/core'
import { validateEnvelope } from '@maritaca/core'
import { messages, events, type DbClient } from '@maritaca/core'

export interface CreateMessageResult {
  messageId: string
  status: string
  channels: string[]
}

/**
 * Create a new message with idempotency checking
 */
export async function createMessage(
  db: DbClient,
  envelope: Envelope,
): Promise<CreateMessageResult> {
  // Validate envelope
  const validatedEnvelope = validateEnvelope(envelope)

  // Check for existing message with same idempotency key
  const existing = await db
    .select()
    .from(messages)
    .where(eq(messages.idempotencyKey, validatedEnvelope.idempotencyKey))
    .limit(1)

  if (existing.length > 0) {
    // Return existing message
    return {
      messageId: existing[0].id,
      status: existing[0].status,
      channels: validatedEnvelope.channels,
    }
  }

  // Create new message
  const messageId = createId()
  const [message] = await db
    .insert(messages)
    .values({
      id: messageId,
      idempotencyKey: validatedEnvelope.idempotencyKey,
      envelope: validatedEnvelope,
      status: 'pending',
    })
    .returning()

  // Emit message.accepted event
  await db.insert(events).values({
    id: createId(),
    messageId: message.id,
    type: 'message.accepted',
    payload: {
      envelope: validatedEnvelope,
    },
  })

  return {
    messageId: message.id,
    status: message.status,
    channels: validatedEnvelope.channels,
  }
}

/**
 * Get message by ID with events
 */
export async function getMessage(
  db: DbClient,
  messageId: string,
): Promise<{
  id: string
  status: string
  envelope: Envelope
  events: Array<{
    id: string
    type: string
    channel?: string
    provider?: string
    payload?: any
    createdAt: Date
  }>
} | null> {
  const [message] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1)

  if (!message) {
    return null
  }

  const messageEvents = await db
    .select()
    .from(events)
    .where(eq(events.messageId, messageId))
    .orderBy(events.createdAt)

  return {
    id: message.id,
    status: message.status,
    envelope: message.envelope,
    events: messageEvents.map((e) => ({
      id: e.id,
      type: e.type,
      channel: e.channel || undefined,
      provider: e.provider || undefined,
      payload: e.payload || undefined,
      createdAt: e.createdAt,
    })),
  }
}

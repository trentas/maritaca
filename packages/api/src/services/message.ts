import { eq, and } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import type { Envelope } from '@maritaca/core'
import { messages, events, type DbClient } from '@maritaca/core'

export interface CreateMessageResult {
  messageId: string
  status: string
  channels: string[]
}

export interface CreateMessageOptions {
  db: DbClient
  envelope: Envelope
  projectId: string
}

/**
 * Create a new message with idempotency checking
 * Uses INSERT ... ON CONFLICT to handle race conditions atomically
 */
export async function createMessage(
  options: CreateMessageOptions,
): Promise<CreateMessageResult> {
  const { db, envelope, projectId } = options

  const messageId = createId()

  // Attempt to insert - ON CONFLICT DO NOTHING handles race conditions
  const inserted = await db
    .insert(messages)
    .values({
      id: messageId,
      projectId,
      idempotencyKey: envelope.idempotencyKey,
      envelope,
      status: 'pending',
    })
    .onConflictDoNothing({
      target: [messages.projectId, messages.idempotencyKey],
    })
    .returning()

  // If insert succeeded, emit event and return new message
  if (inserted.length > 0) {
    const message = inserted[0]

    await db.insert(events).values({
      id: createId(),
      messageId: message.id,
      type: 'message.accepted',
      payload: {
        envelope,
      },
    })

    return {
      messageId: message.id,
      status: message.status,
      channels: envelope.channels,
    }
  }

  // Insert was skipped due to conflict - fetch existing message
  const [existing] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.projectId, projectId),
        eq(messages.idempotencyKey, envelope.idempotencyKey),
      ),
    )
    .limit(1)

  return {
    messageId: existing.id,
    status: existing.status,
    channels: envelope.channels,
  }
}

export interface GetMessageOptions {
  db: DbClient
  messageId: string
  projectId: string
}

/**
 * Get message by ID with events
 * Only returns messages belonging to the specified project
 */
export async function getMessage(
  options: GetMessageOptions,
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
  const { db, messageId, projectId } = options

  const [message] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.projectId, projectId),
      ),
    )
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

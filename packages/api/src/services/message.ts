import { eq, and, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import type { Envelope } from '@maritaca/core'
import { messages, attempts, events, type DbClient } from '@maritaca/core'

export interface CreateMessageResult {
  messageId: string
  status: string
  channels: string[]
  created: boolean
}

export interface CreateMessageOptions {
  db: DbClient
  envelope: Envelope
  projectId: string
}

/**
 * Create a new message with idempotency checking
 * Uses INSERT ... ON CONFLICT to handle race conditions atomically
 *
 * Events: message.accepted is emitted here when the message is persisted.
 * The route emits message.queued when the message is enqueued for delivery (only when created === true).
 */
export async function createMessage(
  options: CreateMessageOptions,
): Promise<CreateMessageResult> {
  const { db, envelope, projectId } = options

  const projectIdStr =
    typeof projectId === 'string' && projectId.trim() !== '' ? projectId.trim() : null
  if (projectIdStr === null) {
    throw new Error('projectId is required')
  }

  const messageId = createId()

  // Attempt to insert - ON CONFLICT DO NOTHING handles race conditions
  // Use sql`...` for project_id so the value is always sent (avoids Drizzle omitting undefined)
  const inserted = await db
    .insert(messages)
    .values({
      id: messageId,
      projectId: sql`${projectIdStr}` as unknown as string,
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
      created: true,
    }
  }

  // Insert was skipped due to conflict - fetch existing message
  const [existing] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.projectId, projectIdStr),
        eq(messages.idempotencyKey, envelope.idempotencyKey),
      ),
    )
    .limit(1)

  return {
    messageId: existing.id,
    status: existing.status,
    channels: envelope.channels,
    created: false,
  }
}

export interface GetMessageOptions {
  db: DbClient
  messageId: string
  projectId: string
}

/** Provider status per channel/provider (e.g. Resend last_event) */
export type ProviderStatus = {
  email?: { resend?: { last_event: string } }
}

/**
 * Get message by ID with events and attempts (including provider status)
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
  attempts: Array<{
    id: string
    channel: string
    provider: string
    status: string
    externalId?: string | null
    providerLastEvent?: string | null
  }>
  providerStatus: ProviderStatus
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

  const [messageEvents, messageAttempts] = await Promise.all([
    db.select().from(events).where(eq(events.messageId, messageId)).orderBy(events.createdAt),
    db.select().from(attempts).where(eq(attempts.messageId, messageId)),
  ])

  const providerStatus: ProviderStatus = {}
  for (const a of messageAttempts) {
    if (a.provider === 'resend' && a.channel === 'email') {
      const lastEvent =
        a.providerLastEvent ?? (a.status === 'succeeded' && a.externalId ? 'sent' : null)
      if (lastEvent) {
        if (!providerStatus.email) providerStatus.email = {}
        providerStatus.email.resend = { last_event: lastEvent }
        break
      }
    }
  }

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
    attempts: messageAttempts.map((a) => ({
      id: a.id,
      channel: a.channel,
      provider: a.provider,
      status: a.status,
      externalId: a.externalId ?? undefined,
      providerLastEvent: a.providerLastEvent ?? undefined,
    })),
    providerStatus,
  }
}

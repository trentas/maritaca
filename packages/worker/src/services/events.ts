import { eq } from 'drizzle-orm'
import { events, type DbClient, type MaritacaEvent } from '@maritaca/core'

/**
 * Emit and persist an event
 */
export async function emitEvent(
  db: DbClient,
  event: MaritacaEvent,
): Promise<void> {
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

/**
 * Get events for a message
 */
export async function getMessageEvents(
  db: DbClient,
  messageId: string,
): Promise<MaritacaEvent[]> {
  const dbEvents = await db
    .select()
    .from(events)
    .where(eq(events.messageId, messageId))
    .orderBy(events.createdAt)

  return dbEvents.map((e) => ({
    id: e.id,
    type: e.type as any,
    messageId: e.messageId,
    channel: e.channel || undefined,
    provider: e.provider || undefined,
    timestamp: e.createdAt,
    payload: e.payload || undefined,
  }))
}

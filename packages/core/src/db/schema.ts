import { pgTable, text, timestamp, jsonb, varchar, pgEnum, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import type { Envelope } from '../types/envelope.js'
import type { MessageStatus, AttemptStatus, EventType } from '../types/event.js'

/**
 * Message status enum
 */
export const messageStatusEnum = pgEnum('message_status', [
  'pending',
  'queued',
  'processing',
  'delivered',
  'failed',
  'partially_delivered',
])

/**
 * Attempt status enum
 */
export const attemptStatusEnum = pgEnum('attempt_status', [
  'pending',
  'started',
  'succeeded',
  'failed',
])

/**
 * Messages table
 * Stores the canonical message envelope and status
 */
export const messages = pgTable('messages', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
  envelope: jsonb('envelope').$type<Envelope>().notNull(),
  status: messageStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

/**
 * Attempts table
 * Tracks individual delivery attempts per channel
 */
export const attempts = pgTable('attempts', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 50 }).notNull(),
  provider: varchar('provider', { length: 100 }).notNull(),
  status: attemptStatusEnum('status').notNull().default('pending'),
  error: text('error'),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
})

/**
 * Events table
 * Stores all events emitted by the system
 */
export const events = pgTable('events', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 100 }).$type<EventType>().notNull(),
  channel: varchar('channel', { length: 50 }),
  provider: varchar('provider', { length: 100 }),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

/**
 * API Keys table
 * Stores API keys for authentication
 */
export const apiKeys = pgTable('api_keys', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  keyHash: varchar('key_hash', { length: 255 }).notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
  projectId: varchar('project_id', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  keyPrefixIdx: index('api_keys_key_prefix_idx').on(table.keyPrefix),
}))

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type Attempt = typeof attempts.$inferSelect
export type NewAttempt = typeof attempts.$inferInsert
export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert

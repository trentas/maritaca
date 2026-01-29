import { pgTable, text, timestamp, jsonb, varchar, pgEnum, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import type { Envelope } from '../types/envelope.js'
import type { MessageStatus, AttemptStatus, EventType } from '../types/event.js'
import type { AuditAction, AuditActorType } from '../types/audit.js'

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
  projectId: varchar('project_id', { length: 255 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
  envelope: jsonb('envelope').$type<Envelope>().notNull(),
  status: messageStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index('messages_project_id_idx').on(table.projectId),
  // UNIQUE so INSERT ... ON CONFLICT (project_id, idempotency_key) works
  idempotencyIdx: uniqueIndex('messages_idempotency_idx').on(table.projectId, table.idempotencyKey),
}))

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
  /** Provider's external id (e.g. Resend email id) for webhook lookup and on-demand status fetch */
  externalId: varchar('external_id', { length: 255 }),
  /** Last delivery event from provider (e.g. delivered, bounced) updated via webhooks */
  providerLastEvent: varchar('provider_last_event', { length: 50 }),
}, (table) => ({
  messageIdIdx: index('attempts_message_id_idx').on(table.messageId),
  externalIdIdx: index('attempts_external_id_idx').on(table.externalId),
}))

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
}, (table) => ({
  messageIdCreatedAtIdx: index('events_message_id_created_at_idx').on(table.messageId, table.createdAt),
}))

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

/**
 * Audit Logs table
 * Partitioned by created_at for efficient sharding
 * Contains encrypted PII data for GDPR/LGPD compliance
 * 
 * Note: This table is partitioned in PostgreSQL. The partitions are
 * created via raw SQL migration (0004_create_audit_logs.sql).
 * Drizzle ORM works with the parent table; PostgreSQL handles routing.
 */
export const auditLogs = pgTable('audit_logs', {
  id: text('id')
    .notNull()
    .$defaultFn(() => createId()),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  
  // Event classification
  action: varchar('action', { length: 100 }).$type<AuditAction>().notNull(),
  
  // Actor
  actorType: varchar('actor_type', { length: 50 }).$type<AuditActorType>().notNull(),
  actorId: text('actor_id').notNull(),
  
  // Subject (for DSAR queries)
  subjectType: varchar('subject_type', { length: 50 }),
  subjectId: text('subject_id'),
  
  // Resource
  resourceType: varchar('resource_type', { length: 50 }).notNull(),
  resourceId: text('resource_id').notNull(),
  
  // Context
  projectId: varchar('project_id', { length: 255 }).notNull(),
  requestId: text('request_id'),
  traceId: text('trace_id'),
  
  // Data
  piiData: jsonb('pii_data'),  // encrypted
  metadata: jsonb('metadata'),
}, (table) => ({
  // Note: Indexes are created in the migration file for partitioned tables
}))

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type Attempt = typeof attempts.$inferSelect
export type NewAttempt = typeof attempts.$inferInsert
export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert
export type AuditLogRecord = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert

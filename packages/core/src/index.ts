// Types
export type {
  Channel,
  Sender,
  SlackRecipient,
  SmsRecipient,
  WhatsAppRecipient,
  TelegramRecipient,
  PushRecipient,
  WebPushKeys,
  WebPushRecipient,
  Recipient,
  Payload,
  ChannelOverrides,
  MessagePriority,
  Envelope,
  EmailProviderType,
  SmsProviderType,
  SnsMessageType,
} from './types/envelope.js'

export type {
  EventType,
  MaritacaEvent,
  MessageStatus,
  AttemptStatus,
} from './types/event.js'

// Provider interfaces
export type { PreparedMessage, ProviderResponse, SendOptions } from './providers/types.js'
export type { Provider } from './providers/base.js'

// Validation
export {
  validateEnvelope,
  safeValidateEnvelope,
  validateChannel,
  envelopeSchema,
  channelSchema,
} from './validation/index.js'

// Database
export * from './db/schema.js'
export { createDbClient, type DbClient } from './db/client.js'

// Re-export commonly used database tables for convenience
export { messages, attempts, events, apiKeys, auditLogs } from './db/schema.js'

// Logger
export { createLogger, createSyncLogger, createChildLogger, type Logger } from './logger/index.js'

// PII Masking
export {
  maskEmail,
  maskPhone,
  maskName,
  maskLogData,
  maskLogDataDeep,
  hashPii,
} from './logger/masking.js'

// Audit
export {
  AuditService,
  type AuditServiceOptions,
  encryptPii,
  decryptPii,
  isEncryptedData,
  type EncryptedData,
  createPartition,
  ensurePartitions,
  dropPartition,
  detachPartition,
  dropOldPartitions,
  getPartitionStats,
} from './audit/index.js'

export type {
  AuditAction,
  AuditActorType,
  AuditActor,
  AuditSubject,
  AuditResource,
  AuditEvent,
  AuditLog,
  AuditQueryOptions,
} from './types/audit.js'

// Redis
export { parseRedisUrl, type RedisConnectionConfig } from './redis/index.js'

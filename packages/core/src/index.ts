// Types
export type {
  Channel,
  Sender,
  Recipient,
  Payload,
  ChannelOverrides,
  MessagePriority,
  Envelope,
} from './types/envelope.js'

export type {
  EventType,
  MaritacaEvent,
  MessageStatus,
  AttemptStatus,
} from './types/event.js'

// Provider interfaces
export type { PreparedMessage, ProviderResponse } from './providers/types.js'
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
export { messages, attempts, events, apiKeys } from './db/schema.js'

// Logger
export { createLogger, createSyncLogger, createChildLogger, type Logger } from './logger/index.js'

// Redis
export { parseRedisUrl, type RedisConnectionConfig } from './redis/index.js'

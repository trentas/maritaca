/**
 * Event types emitted by the Maritaca system
 */
export type EventType =
  | 'message.accepted'
  | 'message.queued'
  | 'attempt.started'
  | 'attempt.succeeded'
  | 'attempt.failed'
  | 'message.delivered'
  | 'message.failed'

/**
 * Base event structure
 */
export interface MaritacaEvent {
  /** Unique event identifier */
  id: string
  /** Event type */
  type: EventType
  /** Associated message ID */
  messageId: string
  /** Channel this event relates to (if applicable) */
  channel?: string
  /** Provider that generated this event (if applicable) */
  provider?: string
  /** Event timestamp */
  timestamp: Date
  /** Additional event payload data */
  payload?: Record<string, any>
}

/**
 * Message status values
 */
export type MessageStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'delivered'
  | 'failed'
  | 'partially_delivered'

/**
 * Attempt status values
 */
export type AttemptStatus = 'pending' | 'started' | 'succeeded' | 'failed'

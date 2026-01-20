/**
 * Channel types supported by Maritaca
 */
export type Channel = 'email' | 'slack' | 'push' | 'web' | 'sms'

/**
 * Sender information for notifications
 */
export interface Sender {
  /** Sender name */
  name?: string
  /** Sender email address */
  email?: string
  /** Slack-specific sender configuration */
  slack?: {
    /** Slack bot token (optional, can be provided per message) */
    botToken?: string
  }
}

/**
 * Recipient information for notifications
 */
export interface Recipient {
  /** User ID for identification */
  userId?: string
  /** Email address */
  email?: string
  /** Slack-specific recipient information */
  slack?: {
    /** Slack user ID */
    userId: string
  }
}

/**
 * Message payload content
 */
export interface Payload {
  /** Message title (optional) */
  title?: string
  /** Plain text message content (required) */
  text: string
  /** HTML content (optional) */
  html?: string
}

/**
 * Channel-specific overrides for message content
 */
export interface ChannelOverrides {
  /** Email-specific overrides */
  email?: {
    /** Email subject line */
    subject?: string
  }
  /** Slack-specific overrides */
  slack?: {
    /** Slack block kit blocks */
    blocks?: any[]
  }
}

/**
 * Message priority levels
 */
export type MessagePriority = 'low' | 'normal' | 'high'

/**
 * Canonical message envelope
 * Represents an intent to communicate, independent of channel
 */
export interface Envelope {
  /** Idempotency key to prevent duplicate messages */
  idempotencyKey: string
  /** Sender information */
  sender: Sender
  /** Single recipient or array of recipients */
  recipient: Recipient | Recipient[]
  /** Channels to send the message through */
  channels: Channel[]
  /** Message payload content */
  payload: Payload
  /** Optional metadata */
  metadata?: Record<string, any>
  /** Channel-specific overrides */
  overrides?: ChannelOverrides
  /** Scheduled send time (optional) */
  scheduleAt?: Date
  /** Message priority */
  priority?: MessagePriority
}

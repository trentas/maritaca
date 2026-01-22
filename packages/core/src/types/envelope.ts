/**
 * Channel types supported by Maritaca
 */
export type Channel = 'email' | 'slack' | 'push' | 'web' | 'sms'

/**
 * Sender information for notifications
 * 
 * Note: Sensitive credentials (like API tokens) should NOT be included here.
 * They are stored in the database and should be configured via environment
 * variables or secure project configuration.
 */
export interface Sender {
  /** Sender name */
  name?: string
  /** Sender email address */
  email?: string
}

/**
 * Slack recipient information
 * At least one identifier must be provided: userId, channelId, channelName, or email
 */
export interface SlackRecipient {
  /** Slack user ID for direct messages (starts with U) */
  userId?: string
  /** Slack channel ID for channel messages (starts with C) */
  channelId?: string
  /** Channel name (e.g., "general" or "#general") - will be normalized */
  channelName?: string
  /** User email - will lookup userId via Slack API */
  email?: string
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
  slack?: SlackRecipient
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
 * Email provider types
 */
export type EmailProviderType = 'resend' | 'ses' | 'mock'

/**
 * Channel-specific overrides for message content
 */
export interface ChannelOverrides {
  /** Email-specific overrides */
  email?: {
    /** Email subject line */
    subject?: string
    /** Email provider to use (overrides default) */
    provider?: EmailProviderType
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

/**
 * Channel types supported by Maritaca
 */
export type Channel = 'email' | 'slack' | 'push' | 'web' | 'sms' | 'whatsapp'

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
 * SMS recipient information (via AWS SNS or Twilio)
 */
export interface SmsRecipient {
  /** Phone number in E.164 format (e.g., +5511999999999) */
  phoneNumber: string
}

/**
 * WhatsApp recipient information (via Twilio)
 */
export interface WhatsAppRecipient {
  /** Phone number in E.164 format (e.g., +5511999999999) */
  phoneNumber: string
}

/**
 * Push notification recipient information (via AWS SNS)
 */
export interface PushRecipient {
  /** SNS Platform Application Endpoint ARN */
  endpointArn?: string
  /** Device token (requires platform to be specified) */
  deviceToken?: string
  /** Platform for device token: APNS, APNS_SANDBOX, GCM (Firebase) */
  platform?: 'APNS' | 'APNS_SANDBOX' | 'GCM'
}

/**
 * Web Push subscription keys
 */
export interface WebPushKeys {
  /** The p256dh key from the subscription */
  p256dh: string
  /** The auth secret from the subscription */
  auth: string
}

/**
 * Web Push recipient information (browser push notifications)
 * This is the PushSubscription object from the browser's Push API
 */
export interface WebPushRecipient {
  /** The push subscription endpoint URL */
  endpoint: string
  /** Optional expiration time of the subscription */
  expirationTime?: number | null
  /** The subscription keys for encryption */
  keys: WebPushKeys
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
  /** SMS recipient (phone number) */
  sms?: SmsRecipient
  /** Push notification recipient (mobile - iOS/Android) */
  push?: PushRecipient
  /** Web Push recipient (browser) */
  web?: WebPushRecipient
  /** WhatsApp recipient (phone number) */
  whatsapp?: WhatsAppRecipient
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
 * SNS SMS message type
 */
export type SnsMessageType = 'Transactional' | 'Promotional'

/**
 * SMS provider types
 */
export type SmsProviderType = 'sns' | 'twilio'

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
  /** SMS-specific overrides */
  sms?: {
    /** SMS provider to use: sns or twilio (overrides default) */
    provider?: SmsProviderType
    /** SMS message type: Transactional (higher delivery) or Promotional (default) - SNS only */
    messageType?: SnsMessageType
    /** Sender ID (alphanumeric, max 11 chars, not supported in all countries) */
    senderId?: string
  }
  /** WhatsApp-specific overrides */
  whatsapp?: {
    /** Content SID for approved template (for initiating conversations) */
    contentSid?: string
    /** Template variables for content SID */
    contentVariables?: Record<string, string>
    /** Media URL to attach (image, document, etc.) */
    mediaUrl?: string
  }
  /** Push notification overrides (mobile) */
  push?: {
    /** Badge count for iOS */
    badge?: number
    /** Sound to play */
    sound?: string
    /** Custom data payload */
    data?: Record<string, any>
    /** Time to live in seconds */
    ttl?: number
  }
  /** Web Push overrides (browser) */
  web?: {
    /** Icon URL for the notification */
    icon?: string
    /** Badge URL (small monochrome icon) */
    badge?: string
    /** Image URL to display in the notification */
    image?: string
    /** Notification tag for grouping/replacing */
    tag?: string
    /** Whether to renotify if same tag */
    renotify?: boolean
    /** Whether notification requires interaction */
    requireInteraction?: boolean
    /** Vibration pattern (array of ms) */
    vibrate?: number[]
    /** Action buttons */
    actions?: Array<{
      action: string
      title: string
      icon?: string
    }>
    /** Custom data payload */
    data?: Record<string, any>
    /** Time to live in seconds */
    ttl?: number
    /** Urgency: very-low, low, normal, high */
    urgency?: 'very-low' | 'low' | 'normal' | 'high'
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

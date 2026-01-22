import { z } from 'zod'
import type { Channel, Envelope } from '../types/envelope.js'

/**
 * Channel schema
 */
export const channelSchema = z.enum(['email', 'slack', 'push', 'web', 'sms', 'whatsapp'])

/**
 * Sender schema
 * Note: Sensitive credentials (like API tokens) should NOT be included here.
 * They should be configured via environment variables or secure project configuration.
 */
export const senderSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
})

/**
 * Slack recipient schema
 * At least one identifier must be provided: userId, channelId, channelName, or email
 */
export const slackRecipientSchema = z
  .object({
    userId: z.string().min(1, 'Slack user ID cannot be empty').optional(),
    channelId: z.string().min(1, 'Slack channel ID cannot be empty').optional(),
    channelName: z.string().min(1, 'Slack channel name cannot be empty').optional(),
    email: z.string().email('Invalid email format').optional(),
  })
  .refine(
    (data) => data.userId || data.channelId || data.channelName || data.email,
    { message: 'At least one of userId, channelId, channelName, or email must be provided for Slack recipient' }
  )

/**
 * SMS recipient schema (E.164 phone number format)
 */
export const smsRecipientSchema = z.object({
  phoneNumber: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be in E.164 format (e.g., +5511999999999)'),
})

/**
 * WhatsApp recipient schema (E.164 phone number format)
 */
export const whatsappRecipientSchema = z.object({
  phoneNumber: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be in E.164 format (e.g., +5511999999999)'),
})

/**
 * Push notification recipient schema (mobile)
 */
export const pushRecipientSchema = z
  .object({
    endpointArn: z.string().optional(),
    deviceToken: z.string().optional(),
    platform: z.enum(['APNS', 'APNS_SANDBOX', 'GCM']).optional(),
  })
  .refine(
    (data) => data.endpointArn || (data.deviceToken && data.platform),
    { message: 'Either endpointArn or both deviceToken and platform must be provided' }
  )

/**
 * Web Push keys schema
 */
export const webPushKeysSchema = z.object({
  p256dh: z.string().min(1, 'p256dh key is required'),
  auth: z.string().min(1, 'auth key is required'),
})

/**
 * Web Push recipient schema (browser push notifications)
 */
export const webPushRecipientSchema = z.object({
  endpoint: z.string().url('endpoint must be a valid URL'),
  expirationTime: z.number().nullable().optional(),
  keys: webPushKeysSchema,
})

/**
 * Recipient schema
 */
export const recipientSchema = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  slack: slackRecipientSchema.optional(),
  sms: smsRecipientSchema.optional(),
  push: pushRecipientSchema.optional(),
  web: webPushRecipientSchema.optional(),
  whatsapp: whatsappRecipientSchema.optional(),
})

/**
 * Payload schema
 */
export const payloadSchema = z.object({
  title: z.string().optional(),
  text: z.string().min(1, 'Text content is required'),
  html: z.string().optional(),
})

/**
 * Email provider schema
 */
export const emailProviderSchema = z.enum(['resend', 'ses', 'mock'])

/**
 * SMS message type schema
 */
export const smsMessageTypeSchema = z.enum(['Transactional', 'Promotional'])

/**
 * SMS provider schema
 */
export const smsProviderSchema = z.enum(['sns', 'twilio'])

/**
 * Channel overrides schema
 */
export const channelOverridesSchema = z.object({
  email: z
    .object({
      subject: z.string().optional(),
      provider: emailProviderSchema.optional(),
    })
    .optional(),
  slack: z
    .object({
      blocks: z.array(z.any()).optional(),
    })
    .optional(),
  sms: z
    .object({
      provider: smsProviderSchema.optional(),
      messageType: smsMessageTypeSchema.optional(),
      senderId: z.string().max(11, 'Sender ID must be 11 characters or less').optional(),
    })
    .optional(),
  whatsapp: z
    .object({
      contentSid: z.string().optional(),
      contentVariables: z.record(z.string()).optional(),
      mediaUrl: z.string().url().optional(),
    })
    .optional(),
  push: z
    .object({
      badge: z.number().int().min(0).optional(),
      sound: z.string().optional(),
      data: z.record(z.any()).optional(),
      ttl: z.number().int().min(0).optional(),
    })
    .optional(),
  web: z
    .object({
      icon: z.string().url().optional(),
      badge: z.string().url().optional(),
      image: z.string().url().optional(),
      tag: z.string().optional(),
      renotify: z.boolean().optional(),
      requireInteraction: z.boolean().optional(),
      vibrate: z.array(z.number().int().min(0)).optional(),
      actions: z
        .array(
          z.object({
            action: z.string(),
            title: z.string(),
            icon: z.string().optional(),
          })
        )
        .optional(),
      data: z.record(z.any()).optional(),
      ttl: z.number().int().min(0).optional(),
      urgency: z.enum(['very-low', 'low', 'normal', 'high']).optional(),
    })
    .optional(),
})

/**
 * Message priority schema
 */
export const messagePrioritySchema = z.enum(['low', 'normal', 'high'])

/**
 * Complete envelope validation schema
 */
export const envelopeSchema = z.object({
  idempotencyKey: z.string().min(1, 'Idempotency key is required'),
  sender: senderSchema,
  recipient: z.union([recipientSchema, z.array(recipientSchema).min(1)]),
  channels: z
    .array(channelSchema)
    .min(1, 'At least one channel is required'),
  payload: payloadSchema,
  metadata: z.record(z.any()).optional(),
  overrides: channelOverridesSchema.optional(),
  scheduleAt: z.coerce.date().optional(),
  priority: messagePrioritySchema.optional(),
})

/**
 * Validate an envelope against the schema
 * @param envelope - The envelope to validate
 * @returns The validated envelope
 * @throws {z.ZodError} If validation fails
 */
export function validateEnvelope(envelope: unknown): Envelope {
  return envelopeSchema.parse(envelope)
}

/**
 * Safely validate an envelope and return result
 * @param envelope - The envelope to validate
 * @returns Validation result with success status and data/error
 */
export function safeValidateEnvelope(envelope: unknown): {
  success: boolean
  data?: Envelope
  error?: z.ZodError
} {
  const result = envelopeSchema.safeParse(envelope)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

/**
 * Validate that a channel is supported
 * @param channel - The channel to validate
 * @returns The validated channel
 * @throws {z.ZodError} If channel is invalid
 */
export function validateChannel(channel: unknown): Channel {
  return channelSchema.parse(channel)
}

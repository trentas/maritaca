import { z } from 'zod'
import type { Channel, Envelope } from '../types/envelope.js'

/**
 * Channel schema
 */
export const channelSchema = z.enum(['email', 'slack', 'push', 'web', 'sms'])

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
 * Recipient schema
 */
export const recipientSchema = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  slack: slackRecipientSchema.optional(),
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

import type {
  Provider,
  Envelope,
  PreparedMessage,
  ProviderResponse,
  MaritacaEvent,
  Logger,
  SendOptions,
  Channel,
} from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'
import {
  createSyncLogger,
  maskPhone,
  recordMessageSent,
  recordProcessingDuration,
  recordProviderError,
  recordRateLimit,
} from '@maritaca/core'
import twilioPkg from 'twilio'
const { Twilio } = twilioPkg
import { trace, SpanStatusCode } from '@opentelemetry/api'

/**
 * Twilio provider options
 */
export interface TwilioProviderOptions {
  logger?: Logger
  /** Twilio Account SID (defaults to TWILIO_ACCOUNT_SID env var) */
  accountSid?: string
  /** Twilio Auth Token (defaults to TWILIO_AUTH_TOKEN env var) */
  authToken?: string
  /** Default SMS sender phone number (E.164) or Messaging Service SID */
  smsFrom?: string
  /** Default WhatsApp sender phone number (E.164) */
  whatsappFrom?: string
  /** Channel this provider is for: 'sms' or 'whatsapp' */
  channel?: 'sms' | 'whatsapp'
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  ok: boolean
  error?: string
  details?: Record<string, any>
}

const tracer = trace.getTracer('maritaca-twilio-provider')

/**
 * Twilio provider implementation
 * 
 * Supports both SMS and WhatsApp messaging via Twilio's API.
 * 
 * For WhatsApp:
 * - Requires a Twilio WhatsApp-enabled number
 * - Template messages (contentSid) required for initiating conversations
 * - Free-form messages allowed within 24h session window
 * 
 * @see https://www.twilio.com/docs/sms
 * @see https://www.twilio.com/docs/whatsapp
 * 
 * @example
 * ```typescript
 * // SMS
 * const smsProvider = new TwilioProvider({
 *   channel: 'sms',
 *   smsFrom: '+15551234567',
 * })
 * 
 * // WhatsApp
 * const waProvider = new TwilioProvider({
 *   channel: 'whatsapp',
 *   whatsappFrom: '+15551234567',
 * })
 * ```
 */
export class TwilioProvider implements Provider {
  channel: Channel
  get name(): string {
    return `twilio-${this.channel}`
  }
  private logger: Logger
  private client: Twilio
  private smsFrom: string
  private whatsappFrom: string
  private accountSid: string

  constructor(options?: TwilioProviderOptions) {
    this.channel = options?.channel ?? 'sms'
    this.logger = options?.logger ?? createSyncLogger({ serviceName: `maritaca-twilio-${this.channel}-provider` })
    
    const accountSid = options?.accountSid ?? process.env.TWILIO_ACCOUNT_SID
    const authToken = options?.authToken ?? process.env.TWILIO_AUTH_TOKEN

    if (!accountSid) {
      throw new Error('TWILIO_ACCOUNT_SID is required for TwilioProvider')
    }

    if (!authToken) {
      throw new Error('TWILIO_AUTH_TOKEN is required for TwilioProvider')
    }

    this.accountSid = accountSid
    this.smsFrom = options?.smsFrom ?? process.env.TWILIO_SMS_FROM ?? ''
    this.whatsappFrom = options?.whatsappFrom ?? process.env.TWILIO_WHATSAPP_FROM ?? ''
    
    this.client = new Twilio(accountSid, authToken)
  }

  /**
   * Validate that the envelope can be sent via Twilio
   */
  validate(envelope: Envelope): void {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    if (this.channel === 'whatsapp') {
      const hasWhatsAppRecipient = recipients.some((r) => r.whatsapp?.phoneNumber)
      if (!hasWhatsAppRecipient) {
        throw new Error('At least one recipient must have a WhatsApp phone number')
      }
      if (!this.whatsappFrom) {
        throw new Error('TWILIO_WHATSAPP_FROM is required for WhatsApp messages')
      }
    } else {
      const hasSmsRecipient = recipients.some((r) => r.sms?.phoneNumber)
      if (!hasSmsRecipient) {
        throw new Error('At least one recipient must have an SMS phone number')
      }
      if (!this.smsFrom) {
        throw new Error('TWILIO_SMS_FROM is required for SMS messages')
      }
    }
  }

  /**
   * Prepare envelope for Twilio API
   */
  prepare(envelope: Envelope): PreparedMessage {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    let phoneNumbers: string[]
    let from: string

    if (this.channel === 'whatsapp') {
      phoneNumbers = recipients
        .filter((r) => r.whatsapp?.phoneNumber)
        .map((r) => r.whatsapp!.phoneNumber)
      from = `whatsapp:${this.whatsappFrom}`
    } else {
      phoneNumbers = recipients
        .filter((r) => r.sms?.phoneNumber)
        .map((r) => r.sms!.phoneNumber)
      from = this.smsFrom
    }

    if (phoneNumbers.length === 0) {
      throw new Error(`No ${this.channel} recipients found`)
    }

    // Build message body
    let body = envelope.payload.text
    if (envelope.payload.title) {
      body = `*${envelope.payload.title}*\n\n${body}`
    }

    // Get channel-specific overrides
    const overrides = this.channel === 'whatsapp' 
      ? envelope.overrides?.whatsapp 
      : envelope.overrides?.sms

    return {
      channel: this.channel,
      data: {
        phoneNumbers,
        from,
        body,
        contentSid: (overrides as any)?.contentSid,
        contentVariables: (overrides as any)?.contentVariables,
        mediaUrl: (overrides as any)?.mediaUrl,
      },
    }
  }

  /**
   * Check if the provider is properly configured
   */
  async healthCheck(): Promise<HealthCheckResult> {
    try {
      // Verify account
      const account = await this.client.api.accounts(this.accountSid).fetch()

      const details: Record<string, any> = {
        accountStatus: account.status,
        accountName: account.friendlyName,
      }

      if (this.channel === 'whatsapp') {
        if (!this.whatsappFrom) {
          return {
            ok: false,
            error: 'TWILIO_WHATSAPP_FROM is not configured',
          }
        }
        details.whatsappFrom = this.whatsappFrom
      } else {
        if (!this.smsFrom) {
          return {
            ok: false,
            error: 'TWILIO_SMS_FROM is not configured',
          }
        }
        details.smsFrom = this.smsFrom
      }

      return {
        ok: true,
        details,
      }
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Failed to connect to Twilio',
        details: { code: error.code },
      }
    }
  }

  /**
   * Send message via Twilio
   */
  async send(prepared: PreparedMessage, options?: SendOptions): Promise<ProviderResponse> {
    const spanName = this.channel === 'whatsapp' ? 'twilio-whatsapp.send' : 'twilio-sms.send'
    const providerName = `twilio-${this.channel}`
    const startTime = Date.now()
    
    return tracer.startActiveSpan(spanName, async (span) => {
      const { phoneNumbers, from, body, contentSid, contentVariables, mediaUrl } = prepared.data
      const messageId = options?.messageId

      // Add semantic span attributes for messaging operations
      span.setAttribute('messaging.system', 'twilio')
      span.setAttribute('messaging.operation', 'send')
      span.setAttribute('messaging.destination.kind', this.channel === 'whatsapp' ? 'whatsapp' : 'sms')
      span.setAttribute('recipient_count', phoneNumbers.length)
      span.setAttribute('channel', this.channel)
      if (messageId) span.setAttribute('message.id', messageId)

      try {
        const results = await Promise.allSettled(
          phoneNumbers.map((phoneNumber: string) =>
            this.sendSingleMessage(phoneNumber, from, body, contentSid, contentVariables, mediaUrl, messageId)
          )
        )

        const successful = results.filter((r) => r.status === 'fulfilled').length
        const failed = results.filter((r) => r.status === 'rejected').length

        span.setAttribute('successful', successful)
        span.setAttribute('failed', failed)

        if (successful === 0) {
          const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'All sends failed' })
          span.end()

          const errorCode = firstError.reason?.code || 'TWILIO_ERROR'
          // Record metrics for the failed send
          recordMessageSent(this.channel, 'error')
          recordProviderError(providerName, errorCode)
          recordProcessingDuration(this.channel, providerName, Date.now() - startTime)
          // Track rate limits (Twilio uses code 429 or error code 20429)
          if (firstError.reason?.status === 429 || errorCode === 20429) {
            recordRateLimit(providerName)
          }

          return {
            success: false,
            error: {
              code: 'TWILIO_ERROR',
              message: firstError.reason?.message || `Failed to send ${this.channel} message`,
              details: { 
                twilioCode: firstError.reason?.code,
                twilioStatus: firstError.reason?.status,
              },
            },
          }
        }

        const messageIds = results
          .filter((r) => r.status === 'fulfilled')
          .map((r) => (r as PromiseFulfilledResult<string>).value)

        span.setStatus({ code: SpanStatusCode.OK })
        span.end()

        // Record metrics for successful send
        recordMessageSent(this.channel, 'success')
        recordProcessingDuration(this.channel, providerName, Date.now() - startTime)

        return {
          success: true,
          data: {
            sent: successful,
            failed,
            messageIds,
          },
          externalId: messageIds[0],
        }
      } catch (error: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        span.recordException(error)
        span.end()

        // Record metrics for the failed send
        recordMessageSent(this.channel, 'error')
        recordProviderError(providerName, 'TWILIO_EXCEPTION')
        recordProcessingDuration(this.channel, providerName, Date.now() - startTime)

        return {
          success: false,
          error: {
            code: 'TWILIO_EXCEPTION',
            message: error.message,
          },
        }
      }
    })
  }

  /**
   * Send message to a single recipient
   */
  private async sendSingleMessage(
    phoneNumber: string,
    from: string,
    body: string,
    contentSid: string | undefined,
    contentVariables: Record<string, string> | undefined,
    mediaUrl: string | undefined,
    messageId: string | undefined,
  ): Promise<string> {
    const to = this.channel === 'whatsapp' ? `whatsapp:${phoneNumber}` : phoneNumber
    const emoji = this.channel === 'whatsapp' ? '📱' : '💬'
    const label = this.channel === 'whatsapp' ? 'WHATSAPP' : 'TWILIO SMS'

    this.logger.info(
      {
        provider: `twilio-${this.channel}`,
        messageId,
        to: maskPhone(phoneNumber),
        hasContentSid: !!contentSid,
        hasMedia: !!mediaUrl,
      },
      `${emoji} [${label}] Sending message`,
    )

    const createOptions: any = {
      to,
      from,
    }

    // Use content template if provided (required for WhatsApp initiation)
    if (contentSid) {
      createOptions.contentSid = contentSid
      if (contentVariables) {
        createOptions.contentVariables = JSON.stringify(contentVariables)
      }
    } else {
      createOptions.body = body
    }

    // Add media if provided
    if (mediaUrl) {
      createOptions.mediaUrl = [mediaUrl]
    }

    const message = await this.client.messages.create(createOptions)

    this.logger.info(
      {
        provider: `twilio-${this.channel}`,
        messageId,
        externalId: message.sid,
        status: message.status,
      },
      `${emoji} [${label}] Message sent successfully`,
    )

    return message.sid
  }

  /**
   * Map provider response to Maritaca events
   */
  mapEvents(
    response: ProviderResponse,
    messageId: string,
  ): MaritacaEvent[] {
    const events: MaritacaEvent[] = []

    if (response.success) {
      events.push({
        id: createId(),
        type: 'attempt.succeeded',
        messageId,
        channel: this.channel,
        provider: `twilio-${this.channel}`,
        timestamp: new Date(),
        payload: response.data,
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: this.channel,
        provider: `twilio-${this.channel}`,
        timestamp: new Date(),
        payload: {
          error: response.error,
        },
      })
    }

    return events
  }
}

import type {
  Provider,
  Envelope,
  PreparedMessage,
  ProviderResponse,
  MaritacaEvent,
  Logger,
} from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'
import { createSyncLogger } from '@maritaca/core'
import { Resend } from 'resend'

/**
 * Resend email provider options
 */
export interface ResendProviderOptions {
  logger?: Logger
  /** Resend API key (defaults to RESEND_API_KEY env var) */
  apiKey?: string
}

/**
 * Resend email provider implementation
 * Uses Resend API to send emails
 * @see https://resend.com/docs
 */
export class ResendProvider implements Provider {
  channel = 'email' as const
  private logger: Logger
  private client: Resend

  constructor(options?: ResendProviderOptions) {
    this.logger = options?.logger ?? createSyncLogger({ serviceName: 'maritaca-resend-provider' })
    
    const apiKey = options?.apiKey ?? process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is required for ResendProvider')
    }
    
    this.client = new Resend(apiKey)
  }

  /**
   * Validate that the envelope can be sent via email
   */
  validate(envelope: Envelope): void {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    // Check if at least one recipient has email
    const hasEmailRecipient = recipients.some((r) => r.email)

    if (!hasEmailRecipient) {
      throw new Error('At least one recipient must have an email address')
    }

    // Resend requires a sender email
    if (!envelope.sender.email) {
      throw new Error('Sender email is required for Resend provider')
    }
  }

  /**
   * Prepare envelope for Resend API
   */
  prepare(envelope: Envelope): PreparedMessage {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    // Get email recipients
    const emailRecipients = recipients
      .filter((r) => r.email)
      .map((r) => r.email!)

    if (emailRecipients.length === 0) {
      throw new Error('No email recipients found')
    }

    // Build email subject
    const subject =
      envelope.overrides?.email?.subject ||
      envelope.payload.title ||
      'Notification'

    // Build from address with optional name
    const from = envelope.sender.name
      ? `${envelope.sender.name} <${envelope.sender.email}>`
      : envelope.sender.email!

    return {
      channel: 'email',
      data: {
        to: emailRecipients,
        from,
        subject,
        text: envelope.payload.text,
        html: envelope.payload.html,
      },
    }
  }

  /**
   * Send email via Resend API
   */
  async send(prepared: PreparedMessage): Promise<ProviderResponse> {
    const { to, from, subject, text, html } = prepared.data

    try {
      this.logger.info(
        {
          provider: 'resend',
          to,
          from,
          subject,
        },
        '📧 [RESEND] Sending email',
      )

      const response = await this.client.emails.send({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        text,
        html,
      })

      if (response.error) {
        this.logger.error(
          {
            provider: 'resend',
            error: response.error,
          },
          '📧 [RESEND] Failed to send email',
        )

        return {
          success: false,
          error: {
            code: response.error.name || 'RESEND_ERROR',
            message: response.error.message,
          },
        }
      }

      this.logger.info(
        {
          provider: 'resend',
          messageId: response.data?.id,
        },
        '📧 [RESEND] Email sent successfully',
      )

      return {
        success: true,
        data: {
          to,
          from,
          subject,
          sentAt: new Date().toISOString(),
        },
        externalId: response.data?.id,
      }
    } catch (error) {
      const err = error as Error
      this.logger.error(
        {
          provider: 'resend',
          error: err.message,
        },
        '📧 [RESEND] Failed to send email',
      )

      return {
        success: false,
        error: {
          code: 'RESEND_EXCEPTION',
          message: err.message,
        },
      }
    }
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
        channel: 'email',
        provider: 'resend',
        timestamp: new Date(),
        payload: response.data,
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'email',
        provider: 'resend',
        timestamp: new Date(),
        payload: {
          error: response.error,
        },
      })
    }

    return events
  }
}

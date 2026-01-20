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

/**
 * Mock email provider implementation
 * Logs messages instead of actually sending them
 */
export class EmailProvider implements Provider {
  channel = 'email' as const
  private logger: Logger

  constructor(logger?: Logger) {
    this.logger = logger ?? createSyncLogger({ serviceName: 'maritaca-email-provider' })
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
  }

  /**
   * Prepare envelope for email (mock)
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

    return {
      channel: 'email',
      data: {
        to: emailRecipients,
        from: envelope.sender.email || 'noreply@maritaca.local',
        subject,
        text: envelope.payload.text,
        html: envelope.payload.html || envelope.payload.text,
      },
    }
  }

  /**
   * Send email (mock - just logs)
   */
  async send(prepared: PreparedMessage): Promise<ProviderResponse> {
    const { to, from, subject, text } = prepared.data

    // Mock email sending - log with structured logger
    this.logger.info(
      {
        provider: 'email',
        mock: true,
        to,
        from,
        subject,
        bodyLength: text?.length || 0,
      },
      '📧 [MOCK EMAIL] Sending email notification',
    )

    // Simulate successful send
    return {
      success: true,
      data: {
        to,
        from,
        subject,
        sentAt: new Date().toISOString(),
      },
      externalId: `mock-${Date.now()}`,
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
        provider: 'email',
        timestamp: new Date(),
        payload: response.data,
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'email',
        provider: 'email',
        timestamp: new Date(),
        payload: {
          error: response.error,
        },
      })
    }

    return events
  }
}

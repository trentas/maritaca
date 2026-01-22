import type {
  Provider,
  Envelope,
  PreparedMessage,
  ProviderResponse,
  MaritacaEvent,
  Logger,
  SendOptions,
} from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'
import { createSyncLogger } from '@maritaca/core'
import { SESClient, SendEmailCommand, GetAccountCommand } from '@aws-sdk/client-ses'
import { trace, SpanStatusCode } from '@opentelemetry/api'

/**
 * SES email provider options
 */
export interface SESProviderOptions {
  logger?: Logger
  /** AWS region (defaults to AWS_REGION env var) */
  region?: string
  /** AWS access key ID (defaults to AWS_ACCESS_KEY_ID env var) */
  accessKeyId?: string
  /** AWS secret access key (defaults to AWS_SECRET_ACCESS_KEY env var) */
  secretAccessKey?: string
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  ok: boolean
  error?: string
  details?: Record<string, any>
}

const tracer = trace.getTracer('maritaca-ses-provider')

/**
 * AWS SES email provider implementation
 * 
 * Uses AWS SES API to send emails with full OpenTelemetry tracing.
 * Supports IAM role authentication when running on AWS infrastructure.
 * 
 * @see https://docs.aws.amazon.com/ses/latest/APIReference/Welcome.html
 * 
 * @example
 * ```typescript
 * // Using environment variables
 * const provider = new SESProvider()
 * 
 * // Using explicit credentials
 * const provider = new SESProvider({
 *   region: 'us-east-1',
 *   accessKeyId: 'AKIA...',
 *   secretAccessKey: '...',
 * })
 * 
 * // Check health before sending
 * const health = await provider.healthCheck()
 * if (!health.ok) {
 *   console.error('SES provider unhealthy:', health.error)
 * }
 * ```
 */
export class SESProvider implements Provider {
  channel = 'email' as const
  private logger: Logger
  private client: SESClient
  private region: string

  constructor(options?: SESProviderOptions) {
    this.logger = options?.logger ?? createSyncLogger({ serviceName: 'maritaca-ses-provider' })
    
    const region = options?.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION
    const accessKeyId = options?.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID
    const secretAccessKey = options?.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY

    if (!region) {
      throw new Error('AWS_REGION is required for SESProvider')
    }

    this.region = region

    // Create SES client - credentials can be from options, env vars, or IAM role
    const clientConfig: { region: string; credentials?: { accessKeyId: string; secretAccessKey: string } } = {
      region,
    }

    // Only set explicit credentials if both are provided
    // Otherwise, AWS SDK will use default credential chain (env vars, IAM role, etc.)
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
      }
    }

    this.client = new SESClient(clientConfig)
  }

  /**
   * Validate that the envelope can be sent via email
   * @throws {Error} If validation fails
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

    // SES requires a sender email
    if (!envelope.sender.email) {
      throw new Error('Sender email is required for SES provider')
    }
  }

  /**
   * Prepare envelope for SES API
   * @throws {Error} If no valid recipients or missing sender email
   */
  prepare(envelope: Envelope): PreparedMessage {
    // Defensive validation - ensure sender email exists
    if (!envelope.sender.email) {
      throw new Error('Sender email is required for SES provider')
    }

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
      : envelope.sender.email

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
   * Check if the provider is properly configured and can connect to AWS SES
   */
  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.region) {
      return {
        ok: false,
        error: 'AWS_REGION is not configured',
      }
    }

    try {
      const command = new GetAccountCommand({})
      const response = await this.client.send(command)

      return {
        ok: true,
        details: {
          region: this.region,
          sendQuota: response.SendQuota,
          enforcementStatus: response.EnforcementStatus,
        },
      }
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Failed to connect to AWS SES',
        details: { code: error.name },
      }
    }
  }

  /**
   * Send email via AWS SES
   */
  async send(prepared: PreparedMessage, options?: SendOptions): Promise<ProviderResponse> {
    return tracer.startActiveSpan('ses.send', async (span) => {
      const { to, from, subject, text, html } = prepared.data
      const recipients = Array.isArray(to) ? to : [to]
      const messageId = options?.messageId

      span.setAttribute('to_count', recipients.length)
      span.setAttribute('from', from)
      span.setAttribute('subject', subject)
      span.setAttribute('region', this.region)
      if (messageId) span.setAttribute('message.id', messageId)

      try {
        this.logger.info(
          {
            provider: 'ses',
            messageId,
            to: recipients,
            from,
            subject,
          },
          '📧 [SES] Sending email',
        )

        const command = new SendEmailCommand({
          Source: from,
          Destination: {
            ToAddresses: recipients,
          },
          Message: {
            Subject: {
              Data: subject,
              Charset: 'UTF-8',
            },
            Body: {
              ...(text && {
                Text: {
                  Data: text,
                  Charset: 'UTF-8',
                },
              }),
              ...(html && {
                Html: {
                  Data: html,
                  Charset: 'UTF-8',
                },
              }),
            },
          },
        })

        const response = await this.client.send(command)

        this.logger.info(
          {
            provider: 'ses',
            messageId,
            externalId: response.MessageId,
          },
          '📧 [SES] Email sent successfully',
        )

        span.setAttribute('externalId', response.MessageId || '')
        span.setStatus({ code: SpanStatusCode.OK })
        span.end()

        return {
          success: true,
          data: {
            to: recipients,
            from,
            subject,
            sentAt: new Date().toISOString(),
          },
          externalId: response.MessageId,
        }
      } catch (error) {
        const err = error as Error
        this.logger.error(
          {
            provider: 'ses',
            messageId,
            error: err.message,
            errorName: err.name,
          },
          '📧 [SES] Failed to send email',
        )

        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()

        return {
          success: false,
          error: {
            code: err.name || 'SES_ERROR',
            message: err.message,
          },
        }
      }
    })
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
        provider: 'ses',
        timestamp: new Date(),
        payload: response.data,
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'email',
        provider: 'ses',
        timestamp: new Date(),
        payload: {
          error: response.error,
        },
      })
    }

    return events
  }
}

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
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

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
 * AWS SES email provider implementation
 * Uses AWS SES API to send emails
 * @see https://docs.aws.amazon.com/ses/latest/APIReference/Welcome.html
 */
export class SESProvider implements Provider {
  channel = 'email' as const
  private logger: Logger
  private client: SESClient

  constructor(options?: SESProviderOptions) {
    this.logger = options?.logger ?? createSyncLogger({ serviceName: 'maritaca-ses-provider' })
    
    const region = options?.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION
    const accessKeyId = options?.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID
    const secretAccessKey = options?.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY

    if (!region) {
      throw new Error('AWS_REGION is required for SESProvider')
    }

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
   * Send email via AWS SES
   */
  async send(prepared: PreparedMessage): Promise<ProviderResponse> {
    const { to, from, subject, text, html } = prepared.data
    const recipients = Array.isArray(to) ? to : [to]

    try {
      this.logger.info(
        {
          provider: 'ses',
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
          messageId: response.MessageId,
        },
        '📧 [SES] Email sent successfully',
      )

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
          error: err.message,
          errorName: err.name,
        },
        '📧 [SES] Failed to send email',
      )

      return {
        success: false,
        error: {
          code: err.name || 'SES_ERROR',
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

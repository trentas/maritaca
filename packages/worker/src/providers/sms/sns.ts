import type {
  Provider,
  Envelope,
  PreparedMessage,
  ProviderResponse,
  MaritacaEvent,
  Logger,
  SendOptions,
  SmsRecipient,
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
import snsSdk from '@aws-sdk/client-sns'
const { SNSClient, PublishCommand, GetSMSAttributesCommand } = snsSdk
import { trace, SpanStatusCode } from '@opentelemetry/api'

/**
 * SNS SMS provider options
 */
export interface SnsSmsProviderOptions {
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

const tracer = trace.getTracer('maritaca-sns-sms-provider')

/**
 * AWS SNS SMS provider implementation
 * 
 * Sends SMS messages via AWS SNS.
 * Supports Transactional (high priority) and Promotional message types.
 * 
 * @see https://docs.aws.amazon.com/sns/latest/dg/sms_publish-to-phone.html
 * 
 * @example
 * ```typescript
 * const provider = new SnsSmsProvider({
 *   region: 'us-east-1',
 * })
 * 
 * // Check health
 * const health = await provider.healthCheck()
 * ```
 */
export class SnsSmsProvider implements Provider {
  channel = 'sms' as const
  name = 'sns-sms'
  private logger: Logger
  private client: SNSClient
  private region: string

  constructor(options?: SnsSmsProviderOptions) {
    this.logger = options?.logger ?? createSyncLogger({ serviceName: 'maritaca-sns-sms-provider' })
    
    const region = options?.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION
    const accessKeyId = options?.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID
    const secretAccessKey = options?.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY

    if (!region) {
      throw new Error('AWS_REGION is required for SnsSmsProvider')
    }

    this.region = region

    const clientConfig: { region: string; credentials?: { accessKeyId: string; secretAccessKey: string } } = {
      region,
    }

    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
      }
    }

    this.client = new SNSClient(clientConfig)
  }

  /**
   * Validate that the envelope can be sent via SMS
   */
  validate(envelope: Envelope): void {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    const hasSmsRecipient = recipients.some((r) => r.sms?.phoneNumber)

    if (!hasSmsRecipient) {
      throw new Error('At least one recipient must have an SMS phone number')
    }
  }

  /**
   * Prepare envelope for SNS SMS API
   */
  prepare(envelope: Envelope): PreparedMessage {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    const phoneNumbers = recipients
      .filter((r) => r.sms?.phoneNumber)
      .map((r) => r.sms!.phoneNumber)

    if (phoneNumbers.length === 0) {
      throw new Error('No SMS recipients found')
    }

    // SMS has a 160 character limit for single SMS, truncate if needed
    let message = envelope.payload.text
    if (envelope.payload.title) {
      message = `${envelope.payload.title}: ${message}`
    }

    // Get SMS overrides
    const smsOverrides = envelope.overrides?.sms
    const messageType = smsOverrides?.messageType ?? 'Transactional'
    const senderId = smsOverrides?.senderId

    return {
      channel: 'sms',
      data: {
        phoneNumbers,
        message,
        messageType,
        senderId,
      },
    }
  }

  /**
   * Check if the provider is properly configured
   */
  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.region) {
      return {
        ok: false,
        error: 'AWS_REGION is not configured',
      }
    }

    try {
      const command = new GetSMSAttributesCommand({
        attributes: ['DefaultSMSType'],
      })
      const response = await this.client.send(command)

      return {
        ok: true,
        details: {
          region: this.region,
          defaultSmsType: response.attributes?.DefaultSMSType,
        },
      }
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Failed to connect to AWS SNS',
        details: { code: error.name },
      }
    }
  }

  /**
   * Send SMS via AWS SNS
   */
  async send(prepared: PreparedMessage, options?: SendOptions): Promise<ProviderResponse> {
    const startTime = Date.now()

    return tracer.startActiveSpan('sns-sms.send', async (span) => {
      const { phoneNumbers, message, messageType, senderId } = prepared.data
      const messageId = options?.messageId

      // Add semantic span attributes for messaging operations
      span.setAttribute('messaging.system', 'sns')
      span.setAttribute('messaging.operation', 'send')
      span.setAttribute('messaging.destination.kind', 'sms')
      span.setAttribute('cloud.provider', 'aws')
      span.setAttribute('cloud.region', this.region)
      span.setAttribute('recipient_count', phoneNumbers.length)
      span.setAttribute('message_type', messageType)
      span.setAttribute('region', this.region)
      if (messageId) span.setAttribute('message.id', messageId)

      try {
        const results = await Promise.allSettled(
          phoneNumbers.map((phoneNumber: string) =>
            this.sendSingleSms(phoneNumber, message, messageType, senderId, messageId)
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

          const errorCode = firstError.reason?.name || 'SNS_SMS_ERROR'
          // Record metrics for the failed send
          recordMessageSent('sms', 'error')
          recordProviderError('sns-sms', errorCode)
          recordProcessingDuration('sms', 'sns-sms', Date.now() - startTime)
          // Track rate limits (SNS uses Throttling exception)
          if (errorCode === 'Throttling' || firstError.reason?.$metadata?.httpStatusCode === 429) {
            recordRateLimit('sns-sms')
          }

          return {
            success: false,
            error: {
              code: 'SNS_SMS_ERROR',
              message: firstError.reason?.message || 'Failed to send SMS',
              details: firstError.reason,
            },
          }
        }

        const messageIds = results
          .filter((r) => r.status === 'fulfilled')
          .map((r) => (r as PromiseFulfilledResult<string>).value)

        span.setStatus({ code: SpanStatusCode.OK })
        span.end()

        // Record metrics for successful send
        recordMessageSent('sms', 'success')
        recordProcessingDuration('sms', 'sns-sms', Date.now() - startTime)

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
        recordMessageSent('sms', 'error')
        recordProviderError('sns-sms', 'SNS_SMS_EXCEPTION')
        recordProcessingDuration('sms', 'sns-sms', Date.now() - startTime)

        return {
          success: false,
          error: {
            code: 'SNS_SMS_EXCEPTION',
            message: error.message,
          },
        }
      }
    })
  }

  /**
   * Send SMS to a single phone number
   */
  private async sendSingleSms(
    phoneNumber: string,
    message: string,
    messageType: string,
    senderId: string | undefined,
    messageId: string | undefined,
  ): Promise<string> {
    this.logger.info(
      {
        provider: 'sns-sms',
        messageId,
        phoneNumber: maskPhone(phoneNumber),
        messageType,
      },
      '📱 [SNS SMS] Sending SMS',
    )

    const messageAttributes: Record<string, any> = {
      'AWS.SNS.SMS.SMSType': {
        DataType: 'String',
        StringValue: messageType,
      },
    }

    if (senderId) {
      messageAttributes['AWS.SNS.SMS.SenderID'] = {
        DataType: 'String',
        StringValue: senderId,
      }
    }

    const command = new PublishCommand({
      PhoneNumber: phoneNumber,
      Message: message,
      MessageAttributes: messageAttributes,
    })

    const response = await this.client.send(command)

    this.logger.info(
      {
        provider: 'sns-sms',
        messageId,
        externalId: response.MessageId,
      },
      '📱 [SNS SMS] SMS sent successfully',
    )

    return response.MessageId!
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
        channel: 'sms',
        provider: 'sns-sms',
        timestamp: new Date(),
        payload: response.data,
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'sms',
        provider: 'sns-sms',
        timestamp: new Date(),
        payload: {
          error: response.error,
        },
      })
    }

    return events
  }
}

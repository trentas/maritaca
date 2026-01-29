import type {
  Provider,
  Envelope,
  PreparedMessage,
  ProviderResponse,
  MaritacaEvent,
  Logger,
  SendOptions,
  PushRecipient,
} from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'
import {
  createSyncLogger,
  recordMessageSent,
  recordProcessingDuration,
  recordProviderError,
  recordRateLimit,
} from '@maritaca/core'
import snsSdk from '@aws-sdk/client-sns'
const {
  SNSClient,
  PublishCommand,
  CreatePlatformEndpointCommand,
  ListPlatformApplicationsCommand,
} = snsSdk
import { trace, SpanStatusCode } from '@opentelemetry/api'

/**
 * SNS Push provider options
 */
export interface SnsPushProviderOptions {
  logger?: Logger
  /** AWS region (defaults to AWS_REGION env var) */
  region?: string
  /** AWS access key ID (defaults to AWS_ACCESS_KEY_ID env var) */
  accessKeyId?: string
  /** AWS secret access key (defaults to AWS_SECRET_ACCESS_KEY env var) */
  secretAccessKey?: string
  /** Platform application ARN for APNS */
  apnsPlatformArn?: string
  /** Platform application ARN for APNS Sandbox */
  apnsSandboxPlatformArn?: string
  /** Platform application ARN for GCM (Firebase) */
  gcmPlatformArn?: string
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  ok: boolean
  error?: string
  details?: Record<string, any>
}

const tracer = trace.getTracer('maritaca-sns-push-provider')

/**
 * AWS SNS Push notification provider implementation
 * 
 * Sends push notifications via AWS SNS to iOS (APNs) and Android (FCM/GCM).
 * 
 * @see https://docs.aws.amazon.com/sns/latest/dg/sns-mobile-application-as-subscriber.html
 */
export class SnsPushProvider implements Provider {
  channel = 'push' as const
  name = 'sns-push'
  private logger: Logger
  private client: SNSClient
  private region: string
  private platformArns: Record<string, string | undefined>

  constructor(options?: SnsPushProviderOptions) {
    this.logger = options?.logger ?? createSyncLogger({ serviceName: 'maritaca-sns-push-provider' })
    
    const region = options?.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION
    const accessKeyId = options?.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID
    const secretAccessKey = options?.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY

    if (!region) {
      throw new Error('AWS_REGION is required for SnsPushProvider')
    }

    this.region = region
    this.platformArns = {
      APNS: options?.apnsPlatformArn ?? process.env.SNS_APNS_PLATFORM_ARN,
      APNS_SANDBOX: options?.apnsSandboxPlatformArn ?? process.env.SNS_APNS_SANDBOX_PLATFORM_ARN,
      GCM: options?.gcmPlatformArn ?? process.env.SNS_GCM_PLATFORM_ARN,
    }

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
   * Validate that the envelope can be sent via push
   */
  validate(envelope: Envelope): void {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    const hasPushRecipient = recipients.some(
      (r) => r.push?.endpointArn || (r.push?.deviceToken && r.push?.platform)
    )

    if (!hasPushRecipient) {
      throw new Error('At least one recipient must have push notification info (endpointArn or deviceToken+platform)')
    }
  }

  /**
   * Prepare envelope for SNS Push API
   */
  prepare(envelope: Envelope): PreparedMessage {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    const pushRecipients = recipients
      .filter((r) => r.push?.endpointArn || (r.push?.deviceToken && r.push?.platform))
      .map((r) => r.push!)

    if (pushRecipients.length === 0) {
      throw new Error('No push notification recipients found')
    }

    const pushOverrides = envelope.overrides?.push

    return {
      channel: 'push',
      data: {
        recipients: pushRecipients,
        title: envelope.payload.title,
        body: envelope.payload.text,
        badge: pushOverrides?.badge,
        sound: pushOverrides?.sound ?? 'default',
        data: pushOverrides?.data,
        ttl: pushOverrides?.ttl,
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
      const command = new ListPlatformApplicationsCommand({})
      const response = await this.client.send(command)

      return {
        ok: true,
        details: {
          region: this.region,
          platformApplications: response.PlatformApplications?.length ?? 0,
          configuredPlatforms: Object.entries(this.platformArns)
            .filter(([_, arn]) => arn)
            .map(([platform]) => platform),
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
   * Send push notification via AWS SNS
   */
  async send(prepared: PreparedMessage, options?: SendOptions): Promise<ProviderResponse> {
    const startTime = Date.now()

    return tracer.startActiveSpan('sns-push.send', async (span) => {
      const { recipients, title, body, badge, sound, data, ttl } = prepared.data
      const messageId = options?.messageId

      // Add semantic span attributes for messaging operations
      span.setAttribute('messaging.system', 'sns')
      span.setAttribute('messaging.operation', 'send')
      span.setAttribute('messaging.destination.kind', 'push')
      span.setAttribute('cloud.provider', 'aws')
      span.setAttribute('cloud.region', this.region)
      span.setAttribute('recipient_count', recipients.length)
      span.setAttribute('region', this.region)
      if (messageId) span.setAttribute('message.id', messageId)

      try {
        const results = await Promise.allSettled(
          recipients.map((recipient: PushRecipient) =>
            this.sendSinglePush(recipient, title, body, badge, sound, data, ttl, messageId)
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

          const errorCode = firstError.reason?.name || 'SNS_PUSH_ERROR'
          // Record metrics for the failed send
          recordMessageSent('push', 'error')
          recordProviderError('sns-push', errorCode)
          recordProcessingDuration('push', 'sns-push', Date.now() - startTime)
          // Track rate limits (SNS uses Throttling exception)
          if (errorCode === 'Throttling' || firstError.reason?.$metadata?.httpStatusCode === 429) {
            recordRateLimit('sns-push')
          }

          return {
            success: false,
            error: {
              code: 'SNS_PUSH_ERROR',
              message: firstError.reason?.message || 'Failed to send push notification',
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
        recordMessageSent('push', 'success')
        recordProcessingDuration('push', 'sns-push', Date.now() - startTime)

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
        recordMessageSent('push', 'error')
        recordProviderError('sns-push', 'SNS_PUSH_EXCEPTION')
        recordProcessingDuration('push', 'sns-push', Date.now() - startTime)

        return {
          success: false,
          error: {
            code: 'SNS_PUSH_EXCEPTION',
            message: error.message,
          },
        }
      }
    })
  }

  /**
   * Get or create endpoint ARN for a device token
   */
  private async getEndpointArn(recipient: PushRecipient): Promise<string> {
    if (recipient.endpointArn) {
      return recipient.endpointArn
    }

    if (!recipient.deviceToken || !recipient.platform) {
      throw new Error('Device token and platform are required')
    }

    const platformArn = this.platformArns[recipient.platform]
    if (!platformArn) {
      throw new Error(`Platform application ARN not configured for ${recipient.platform}`)
    }

    const command = new CreatePlatformEndpointCommand({
      PlatformApplicationArn: platformArn,
      Token: recipient.deviceToken,
    })

    const response = await this.client.send(command)
    return response.EndpointArn!
  }

  /**
   * Build platform-specific message payload
   */
  private buildMessage(
    platform: string,
    title: string | undefined,
    body: string,
    badge: number | undefined,
    sound: string | undefined,
    data: Record<string, any> | undefined,
  ): string {
    if (platform === 'GCM') {
      // Firebase Cloud Messaging format
      const fcmPayload = {
        notification: {
          title,
          body,
          sound,
        },
        data: data ?? {},
      }
      return JSON.stringify({ GCM: JSON.stringify(fcmPayload) })
    }

    // APNs format (iOS)
    const apsPayload: any = {
      aps: {
        alert: title ? { title, body } : body,
        sound: sound ?? 'default',
      },
    }

    if (badge !== undefined) {
      apsPayload.aps.badge = badge
    }

    if (data) {
      Object.assign(apsPayload, data)
    }

    const key = platform === 'APNS_SANDBOX' ? 'APNS_SANDBOX' : 'APNS'
    return JSON.stringify({ [key]: JSON.stringify(apsPayload) })
  }

  /**
   * Send push notification to a single recipient
   */
  private async sendSinglePush(
    recipient: PushRecipient,
    title: string | undefined,
    body: string,
    badge: number | undefined,
    sound: string | undefined,
    data: Record<string, any> | undefined,
    ttl: number | undefined,
    messageId: string | undefined,
  ): Promise<string> {
    const endpointArn = await this.getEndpointArn(recipient)
    const platform = recipient.platform ?? 'APNS' // Default to APNS if using endpointArn

    this.logger.info(
      {
        provider: 'sns-push',
        messageId,
        platform,
        hasTitle: !!title,
      },
      '📲 [SNS PUSH] Sending push notification',
    )

    const message = this.buildMessage(platform, title, body, badge, sound, data)

    const command = new PublishCommand({
      TargetArn: endpointArn,
      Message: message,
      MessageStructure: 'json',
      ...(ttl && {
        MessageAttributes: {
          'AWS.SNS.MOBILE.APNS.TTL': {
            DataType: 'String',
            StringValue: String(ttl),
          },
          'AWS.SNS.MOBILE.GCM.TTL': {
            DataType: 'String',
            StringValue: String(ttl),
          },
        },
      }),
    })

    const response = await this.client.send(command)

    this.logger.info(
      {
        provider: 'sns-push',
        messageId,
        externalId: response.MessageId,
      },
      '📲 [SNS PUSH] Push notification sent successfully',
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
        channel: 'push',
        provider: 'sns-push',
        timestamp: new Date(),
        payload: response.data,
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'push',
        provider: 'sns-push',
        timestamp: new Date(),
        payload: {
          error: response.error,
        },
      })
    }

    return events
  }
}

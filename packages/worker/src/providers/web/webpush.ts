import type {
  Provider,
  Envelope,
  PreparedMessage,
  ProviderResponse,
  MaritacaEvent,
  Logger,
  SendOptions,
  WebPushRecipient,
} from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'
import {
  createSyncLogger,
  recordMessageSent,
  recordProcessingDuration,
  recordProviderError,
  recordRateLimit,
} from '@maritaca/core'
import webpush from 'web-push'
import type { PushSubscription, SendResult } from 'web-push'
import { trace, SpanStatusCode } from '@opentelemetry/api'

/**
 * Web Push provider options
 */
export interface WebPushProviderOptions {
  logger?: Logger
  /** VAPID public key (required) */
  vapidPublicKey?: string
  /** VAPID private key (required) */
  vapidPrivateKey?: string
  /** VAPID subject (mailto: or https: URL) */
  vapidSubject?: string
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  ok: boolean
  error?: string
  details?: Record<string, any>
}

/**
 * Web Push notification options
 */
interface WebPushOptions {
  icon?: string
  badge?: string
  image?: string
  tag?: string
  renotify?: boolean
  requireInteraction?: boolean
  vibrate?: number[]
  actions?: Array<{
    action: string
    title: string
    icon?: string
  }>
  data?: Record<string, any>
}

const tracer = trace.getTracer('maritaca-web-push-provider')

/**
 * Web Push provider implementation
 * 
 * Sends push notifications to web browsers via the Web Push Protocol.
 * Uses VAPID for authentication.
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Push_API
 * @see https://tools.ietf.org/html/rfc8030
 * 
 * @example
 * ```typescript
 * const provider = new WebPushProvider({
 *   vapidPublicKey: 'BEl62iUYgUivx...',
 *   vapidPrivateKey: 'UUxI4O8k2r...',
 *   vapidSubject: 'mailto:admin@example.com',
 * })
 * 
 * // Check health
 * const health = await provider.healthCheck()
 * ```
 */
export class WebPushProvider implements Provider {
  channel = 'web' as const
  name = 'web-push'
  private logger: Logger
  private vapidPublicKey: string
  private vapidPrivateKey: string
  private vapidSubject: string
  private configured: boolean = false

  constructor(options?: WebPushProviderOptions) {
    this.logger = options?.logger ?? createSyncLogger({ serviceName: 'maritaca-web-push-provider' })
    
    this.vapidPublicKey = options?.vapidPublicKey ?? process.env.VAPID_PUBLIC_KEY ?? ''
    this.vapidPrivateKey = options?.vapidPrivateKey ?? process.env.VAPID_PRIVATE_KEY ?? ''
    this.vapidSubject = options?.vapidSubject ?? process.env.VAPID_SUBJECT ?? ''

    if (this.vapidPublicKey && this.vapidPrivateKey && this.vapidSubject) {
      webpush.setVapidDetails(
        this.vapidSubject,
        this.vapidPublicKey,
        this.vapidPrivateKey,
      )
      this.configured = true
    }
  }

  /**
   * Validate that the envelope can be sent via Web Push
   */
  validate(envelope: Envelope): void {
    if (!this.configured) {
      throw new Error('Web Push provider is not configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.')
    }

    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    const hasWebRecipient = recipients.some(
      (r) => r.web?.endpoint && r.web?.keys?.p256dh && r.web?.keys?.auth
    )

    if (!hasWebRecipient) {
      throw new Error('At least one recipient must have web push subscription (endpoint and keys)')
    }
  }

  /**
   * Prepare envelope for Web Push API
   */
  prepare(envelope: Envelope): PreparedMessage {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    const webRecipients = recipients
      .filter((r) => r.web?.endpoint && r.web?.keys?.p256dh && r.web?.keys?.auth)
      .map((r) => r.web!)

    if (webRecipients.length === 0) {
      throw new Error('No web push recipients found')
    }

    const webOverrides = envelope.overrides?.web

    // Build notification payload
    const notification: Record<string, any> = {
      title: envelope.payload.title ?? 'Notification',
      body: envelope.payload.text,
    }

    // Add optional fields from overrides
    if (webOverrides?.icon) notification.icon = webOverrides.icon
    if (webOverrides?.badge) notification.badge = webOverrides.badge
    if (webOverrides?.image) notification.image = webOverrides.image
    if (webOverrides?.tag) notification.tag = webOverrides.tag
    if (webOverrides?.renotify !== undefined) notification.renotify = webOverrides.renotify
    if (webOverrides?.requireInteraction !== undefined) notification.requireInteraction = webOverrides.requireInteraction
    if (webOverrides?.vibrate) notification.vibrate = webOverrides.vibrate
    if (webOverrides?.actions) notification.actions = webOverrides.actions
    if (webOverrides?.data) notification.data = webOverrides.data

    return {
      channel: 'web',
      data: {
        recipients: webRecipients,
        notification,
        ttl: webOverrides?.ttl ?? 86400, // 24 hours default
        urgency: webOverrides?.urgency ?? 'normal',
      },
    }
  }

  /**
   * Check if the provider is properly configured
   */
  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.vapidPublicKey) {
      return {
        ok: false,
        error: 'VAPID_PUBLIC_KEY is not configured',
      }
    }

    if (!this.vapidPrivateKey) {
      return {
        ok: false,
        error: 'VAPID_PRIVATE_KEY is not configured',
      }
    }

    if (!this.vapidSubject) {
      return {
        ok: false,
        error: 'VAPID_SUBJECT is not configured',
      }
    }

    // Validate VAPID subject format
    if (!this.vapidSubject.startsWith('mailto:') && !this.vapidSubject.startsWith('https://')) {
      return {
        ok: false,
        error: 'VAPID_SUBJECT must start with mailto: or https://',
      }
    }

    return {
      ok: true,
      details: {
        vapidPublicKeyConfigured: true,
        vapidSubject: this.vapidSubject,
      },
    }
  }

  /**
   * Send Web Push notification
   */
  async send(prepared: PreparedMessage, options?: SendOptions): Promise<ProviderResponse> {
    const startTime = Date.now()

    return tracer.startActiveSpan('web-push.send', async (span) => {
      const { recipients, notification, ttl, urgency } = prepared.data
      const messageId = options?.messageId

      // Add semantic span attributes for messaging operations
      span.setAttribute('messaging.system', 'web-push')
      span.setAttribute('messaging.operation', 'send')
      span.setAttribute('messaging.destination.kind', 'web')
      span.setAttribute('recipient_count', recipients.length)
      span.setAttribute('urgency', urgency)
      if (messageId) span.setAttribute('message.id', messageId)

      try {
        const results = await Promise.allSettled(
          recipients.map((recipient: WebPushRecipient) =>
            this.sendSinglePush(recipient, notification, ttl, urgency, messageId)
          )
        )

        const successful = results.filter((r) => r.status === 'fulfilled').length
        const failed = results.filter((r) => r.status === 'rejected').length
        const expired = results.filter(
          (r) => r.status === 'rejected' && (r.reason as any)?.statusCode === 410
        ).length

        span.setAttribute('successful', successful)
        span.setAttribute('failed', failed)
        span.setAttribute('expired_subscriptions', expired)

        if (successful === 0) {
          const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'All sends failed' })
          span.end()

          const statusCode = firstError.reason?.statusCode
          // Record metrics for the failed send
          recordMessageSent('web', 'error')
          recordProviderError('web-push', statusCode?.toString() || 'WEB_PUSH_ERROR')
          recordProcessingDuration('web', 'web-push', Date.now() - startTime)
          // Track rate limits (HTTP 429)
          if (statusCode === 429) {
            recordRateLimit('web-push')
          }

          return {
            success: false,
            error: {
              code: 'WEB_PUSH_ERROR',
              message: firstError.reason?.message || 'Failed to send web push notification',
              details: {
                statusCode,
                expired,
              },
            },
          }
        }

        span.setStatus({ code: SpanStatusCode.OK })
        span.end()

        // Record metrics for successful send
        recordMessageSent('web', 'success')
        recordProcessingDuration('web', 'web-push', Date.now() - startTime)

        return {
          success: true,
          data: {
            sent: successful,
            failed,
            expiredSubscriptions: expired,
          },
        }
      } catch (error: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        span.recordException(error)
        span.end()

        // Record metrics for the failed send
        recordMessageSent('web', 'error')
        recordProviderError('web-push', 'WEB_PUSH_EXCEPTION')
        recordProcessingDuration('web', 'web-push', Date.now() - startTime)

        return {
          success: false,
          error: {
            code: 'WEB_PUSH_EXCEPTION',
            message: error.message,
          },
        }
      }
    })
  }

  /**
   * Send push notification to a single subscription
   */
  private async sendSinglePush(
    recipient: WebPushRecipient,
    notification: Record<string, any>,
    ttl: number,
    urgency: string,
    messageId: string | undefined,
  ): Promise<SendResult> {
    const subscription: PushSubscription = {
      endpoint: recipient.endpoint,
      keys: {
        p256dh: recipient.keys.p256dh,
        auth: recipient.keys.auth,
      },
    }

    this.logger.info(
      {
        provider: 'web-push',
        messageId,
        endpoint: this.maskEndpoint(recipient.endpoint),
        hasTitle: !!notification.title,
      },
      '🌐 [WEB PUSH] Sending push notification',
    )

    const payload = JSON.stringify(notification)

    const result = await webpush.sendNotification(subscription, payload, {
      TTL: ttl,
      urgency: urgency as 'very-low' | 'low' | 'normal' | 'high',
    })

    this.logger.info(
      {
        provider: 'web-push',
        messageId,
        statusCode: result.statusCode,
      },
      '🌐 [WEB PUSH] Push notification sent successfully',
    )

    return result
  }

  /**
   * Mask endpoint URL for logging (hide token)
   */
  private maskEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint)
      const pathParts = url.pathname.split('/')
      if (pathParts.length > 1) {
        const lastPart = pathParts[pathParts.length - 1]
        if (lastPart.length > 10) {
          pathParts[pathParts.length - 1] = `${lastPart.substring(0, 5)}...${lastPart.substring(lastPart.length - 5)}`
        }
      }
      url.pathname = pathParts.join('/')
      return url.toString()
    } catch {
      return '[invalid-endpoint]'
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
        channel: 'web',
        provider: 'web-push',
        timestamp: new Date(),
        payload: response.data,
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'web',
        provider: 'web-push',
        timestamp: new Date(),
        payload: {
          error: response.error,
        },
      })
    }

    return events
  }

  /**
   * Generate VAPID keys for initial setup
   * 
   * @example
   * ```typescript
   * const keys = WebPushProvider.generateVapidKeys()
   * console.log('Public:', keys.publicKey)
   * console.log('Private:', keys.privateKey)
   * ```
   */
  static generateVapidKeys(): { publicKey: string; privateKey: string } {
    return webpush.generateVAPIDKeys()
  }
}

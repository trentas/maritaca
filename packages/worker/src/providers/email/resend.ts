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
import {
  createSyncLogger,
  maskLogData,
  recordMessageSent,
  recordProcessingDuration,
  recordProviderError,
  recordRateLimit,
} from '@maritaca/core'
import { Resend } from 'resend'
import { trace, SpanStatusCode } from '@opentelemetry/api'

/**
 * Resend email provider options
 */
export interface ResendProviderOptions {
  logger?: Logger
  /** Resend API key (defaults to RESEND_API_KEY env var) */
  apiKey?: string
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  ok: boolean
  error?: string
  details?: Record<string, unknown>
}

const tracer = trace.getTracer('maritaca-resend-provider')

/**
 * Resend email provider implementation
 * 
 * Uses Resend API to send emails with full OpenTelemetry tracing.
 * 
 * @see https://resend.com/docs
 * 
 * @example
 * ```typescript
 * const provider = new ResendProvider({
 *   apiKey: 're_xxxxx', // or use RESEND_API_KEY env var
 * })
 * 
 * // Check health before sending
 * const health = await provider.healthCheck()
 * if (!health.ok) {
 *   console.error('Resend provider unhealthy:', health.error)
 * }
 * ```
 */
export class ResendProvider implements Provider {
  channel = 'email' as const
  name = 'resend'
  private logger: Logger
  private client: Resend
  private apiKey: string

  constructor(options?: ResendProviderOptions) {
    this.logger = options?.logger ?? createSyncLogger({ serviceName: 'maritaca-resend-provider' })
    
    const apiKey = options?.apiKey ?? process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is required for ResendProvider')
    }
    
    this.apiKey = apiKey
    this.client = new Resend(apiKey)
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

    // Resend requires a sender email
    if (!envelope.sender.email) {
      throw new Error('Sender email is required for Resend provider')
    }
  }

  /**
   * Prepare envelope for Resend API
   * @throws {Error} If no valid recipients, missing sender email, or no content
   */
  prepare(envelope: Envelope): PreparedMessage {
    // Defensive validation - ensure sender email exists
    if (!envelope.sender.email) {
      throw new Error('Sender email is required for Resend provider')
    }

    // Resend requires at least text or html content
    if (!envelope.payload.text && !envelope.payload.html) {
      throw new Error('Email must have at least text or html content')
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
   * Check if the provider is properly configured and can connect to Resend
   */
  async healthCheck(): Promise<HealthCheckResult> {
    try {
      // Resend doesn't have a dedicated health check endpoint,
      // so we try to list domains (requires valid API key)
      const response = await this.client.domains.list()
      
      if (response.error) {
        return {
          ok: false,
          error: response.error.message,
          details: { code: response.error.name },
        }
      }

      return {
        ok: true,
        details: {
          domainCount: response.data?.data?.length ?? 0,
        },
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to connect to Resend'
      return {
        ok: false,
        error: message,
      }
    }
  }

  /**
   * Send email via Resend API
   */
  async send(prepared: PreparedMessage, options?: SendOptions): Promise<ProviderResponse> {
    const startTime = Date.now()

    return tracer.startActiveSpan('resend.send', async (span) => {
      const { to, from, subject, text, html } = prepared.data
      const messageId = options?.messageId

      // Add semantic span attributes for messaging operations
      span.setAttribute('messaging.system', 'resend')
      span.setAttribute('messaging.operation', 'send')
      span.setAttribute('messaging.destination.kind', 'email')
      span.setAttribute('to_count', Array.isArray(to) ? to.length : 1)
      span.setAttribute('from', from)
      span.setAttribute('subject', subject)
      if (messageId) span.setAttribute('message.id', messageId)

      try {
        this.logger.info(
          maskLogData({
            provider: 'resend',
            messageId,
            to,
            from,
            subject,
          }),
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
              messageId,
              errorCode: response.error.name,
              errorMessage: response.error.message,
            },
            '📧 [RESEND] Failed to send email',
          )

          span.setStatus({ code: SpanStatusCode.ERROR, message: response.error.message })
          span.end()

          const errorCode = response.error.name || 'RESEND_ERROR'
          // Record metrics for the failed send
          recordMessageSent('email', 'error')
          recordProviderError('resend', errorCode)
          recordProcessingDuration('email', 'resend', Date.now() - startTime)
          // Track rate limits
          if (errorCode === 'rate_limit_exceeded') {
            recordRateLimit('resend')
          }

          return {
            success: false,
            error: {
              code: errorCode,
              message: response.error.message,
            },
          }
        }

        this.logger.info(
          {
            provider: 'resend',
            messageId,
            externalId: response.data?.id,
          },
          '📧 [RESEND] Email sent successfully',
        )

        span.setAttribute('externalId', response.data?.id || '')
        span.setStatus({ code: SpanStatusCode.OK })
        span.end()

        // Record metrics for successful send
        recordMessageSent('email', 'success')
        recordProcessingDuration('email', 'resend', Date.now() - startTime)

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
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        this.logger.error(
          {
            provider: 'resend',
            messageId,
            error: errorMessage,
          },
          '📧 [RESEND] Failed to send email',
        )

        span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage })
        if (error instanceof Error) {
          span.recordException(error)
        }
        span.end()

        // Record metrics for the failed send
        recordMessageSent('email', 'error')
        recordProviderError('resend', 'RESEND_EXCEPTION')
        recordProcessingDuration('email', 'resend', Date.now() - startTime)

        return {
          success: false,
          error: {
            code: 'RESEND_EXCEPTION',
            message: errorMessage,
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
        provider: 'resend',
        timestamp: new Date(),
        payload: { ...response.data, externalId: response.externalId },
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

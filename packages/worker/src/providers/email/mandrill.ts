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
import mailchimpFactory, {
  type MandrillClient,
  type MandrillMessage,
} from '@mailchimp/mailchimp_transactional'
import { trace, SpanStatusCode } from '@opentelemetry/api'

export interface MandrillProviderOptions {
  logger?: Logger
  /** Mandrill API key (defaults to MANDRILL_API_KEY env var) */
  apiKey?: string
}

export interface HealthCheckResult {
  ok: boolean
  error?: string
  details?: Record<string, unknown>
}

const tracer = trace.getTracer('maritaca-mandrill-provider')

/**
 * Mandrill (Mailchimp Transactional) email provider.
 *
 * @see https://mailchimp.com/developer/transactional/api/
 */
export class MandrillProvider implements Provider {
  channel = 'email' as const
  name = 'mandrill'
  private logger: Logger
  private client: MandrillClient

  constructor(options?: MandrillProviderOptions) {
    this.logger = options?.logger ?? createSyncLogger({ serviceName: 'maritaca-mandrill-provider' })

    const apiKey = options?.apiKey ?? process.env.MANDRILL_API_KEY
    if (!apiKey) {
      throw new Error('MANDRILL_API_KEY is required for MandrillProvider')
    }

    this.client = mailchimpFactory(apiKey)
  }

  validate(envelope: Envelope): void {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    const hasEmailRecipient = recipients.some((r) => r.email)

    if (!hasEmailRecipient) {
      throw new Error('At least one recipient must have an email address')
    }

    if (!envelope.sender.email) {
      throw new Error('Sender email is required for Mandrill provider')
    }
  }

  prepare(envelope: Envelope): PreparedMessage {
    if (!envelope.sender.email) {
      throw new Error('Sender email is required for Mandrill provider')
    }

    if (!envelope.payload.text && !envelope.payload.html) {
      throw new Error('Email must have at least text or html content')
    }

    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    const emailRecipients = recipients
      .filter((r) => r.email)
      .map((r) => r.email!)

    if (emailRecipients.length === 0) {
      throw new Error('No email recipients found')
    }

    const subject =
      envelope.overrides?.email?.subject ||
      envelope.payload.title ||
      'Notification'

    const replyTo = envelope.overrides?.email?.replyTo

    return {
      channel: 'email',
      data: {
        to: emailRecipients,
        fromEmail: envelope.sender.email,
        fromName: envelope.sender.name,
        replyTo,
        subject,
        text: envelope.payload.text,
        html: envelope.payload.html,
      },
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await this.client.users.ping()
      const pong = typeof response === 'string' ? response : (response as { message?: string })?.message
      if (typeof pong === 'string' && pong.toUpperCase().includes('PONG')) {
        return { ok: true, details: { pong } }
      }
      return {
        ok: false,
        error: typeof response === 'string' ? response : (response as { message?: string })?.message ?? 'Unexpected ping response',
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to connect to Mandrill'
      return { ok: false, error: message }
    }
  }

  async send(prepared: PreparedMessage, options?: SendOptions): Promise<ProviderResponse> {
    const startTime = Date.now()

    return tracer.startActiveSpan('mandrill.send', async (span) => {
      const { to, fromEmail, fromName, replyTo, subject, text, html } = prepared.data as {
        to: string[]
        fromEmail: string
        fromName?: string
        replyTo?: string
        subject: string
        text?: string
        html?: string
      }
      const messageId = options?.messageId

      span.setAttribute('messaging.system', 'mandrill')
      span.setAttribute('messaging.operation', 'send')
      span.setAttribute('messaging.destination.kind', 'email')
      span.setAttribute('to_count', to.length)
      span.setAttribute('from', fromEmail)
      span.setAttribute('subject', subject)
      if (messageId) span.setAttribute('message.id', messageId)

      const message: MandrillMessage = {
        from_email: fromEmail,
        ...(fromName ? { from_name: fromName } : {}),
        to: to.map((email) => ({ email, type: 'to' })),
        subject,
        ...(text ? { text } : {}),
        ...(html ? { html } : {}),
        ...(replyTo ? { headers: { 'Reply-To': replyTo } } : {}),
      }

      try {
        this.logger.info(
          maskLogData({
            provider: 'mandrill',
            messageId,
            to,
            from: fromEmail,
            subject,
          }),
          '📧 [MANDRILL] Sending email',
        )

        const response = await this.client.messages.send({ message })

        if (!Array.isArray(response)) {
          const errMessage = (response as { message?: string })?.message ?? 'Unknown Mandrill error'
          const errCode = (response as { name?: string })?.name ?? 'MANDRILL_ERROR'

          this.logger.error(
            { provider: 'mandrill', messageId, errorCode: errCode, errorMessage: errMessage },
            '📧 [MANDRILL] Failed to send email',
          )

          span.setStatus({ code: SpanStatusCode.ERROR, message: errMessage })
          span.end()

          recordMessageSent('email', 'error')
          recordProviderError('mandrill', errCode)
          recordProcessingDuration('email', 'mandrill', Date.now() - startTime)
          if (errCode === 'ValidationError' || /rate.?limit/i.test(errMessage)) {
            recordRateLimit('mandrill')
          }

          return {
            success: false,
            error: { code: errCode, message: errMessage },
          }
        }

        const rejected = response.filter((r) => r.status === 'rejected' || r.status === 'invalid')
        const accepted = response.filter((r) => r.status === 'sent' || r.status === 'queued' || r.status === 'scheduled')

        if (accepted.length === 0) {
          const first = rejected[0]
          const code = first?.reject_reason || 'rejected'
          this.logger.error(
            { provider: 'mandrill', messageId, rejected: rejected.map((r) => ({ email: r.email, reason: r.reject_reason })) },
            '📧 [MANDRILL] All recipients rejected',
          )

          span.setStatus({ code: SpanStatusCode.ERROR, message: `All recipients rejected: ${code}` })
          span.end()

          recordMessageSent('email', 'error')
          recordProviderError('mandrill', code)
          recordProcessingDuration('email', 'mandrill', Date.now() - startTime)

          return {
            success: false,
            error: {
              code,
              message: `Mandrill rejected all recipients (${code})`,
              details: { rejected },
            },
          }
        }

        const externalId = accepted[0]._id

        this.logger.info(
          {
            provider: 'mandrill',
            messageId,
            externalId,
            acceptedCount: accepted.length,
            rejectedCount: rejected.length,
          },
          '📧 [MANDRILL] Email sent successfully',
        )

        span.setAttribute('externalId', externalId || '')
        span.setStatus({ code: SpanStatusCode.OK })
        span.end()

        recordMessageSent('email', 'success')
        recordProcessingDuration('email', 'mandrill', Date.now() - startTime)

        return {
          success: true,
          data: {
            to,
            from: fromEmail,
            subject,
            sentAt: new Date().toISOString(),
            ...(rejected.length > 0 ? { partialFailure: true, rejected } : {}),
          },
          externalId,
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        this.logger.error(
          { provider: 'mandrill', messageId, error: errorMessage },
          '📧 [MANDRILL] Failed to send email',
        )

        span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage })
        if (error instanceof Error) {
          span.recordException(error)
        }
        span.end()

        recordMessageSent('email', 'error')
        recordProviderError('mandrill', 'MANDRILL_EXCEPTION')
        recordProcessingDuration('email', 'mandrill', Date.now() - startTime)

        return {
          success: false,
          error: { code: 'MANDRILL_EXCEPTION', message: errorMessage },
        }
      }
    })
  }

  mapEvents(response: ProviderResponse, messageId: string): MaritacaEvent[] {
    const events: MaritacaEvent[] = []

    if (response.success) {
      events.push({
        id: createId(),
        type: 'attempt.succeeded',
        messageId,
        channel: 'email',
        provider: 'mandrill',
        timestamp: new Date(),
        payload: { ...response.data, externalId: response.externalId },
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'email',
        provider: 'mandrill',
        timestamp: new Date(),
        payload: { error: response.error },
      })
    }

    return events
  }
}

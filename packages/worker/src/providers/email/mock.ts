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
} from '@maritaca/core'
import { trace, SpanStatusCode } from '@opentelemetry/api'

/**
 * Simulation options for testing different scenarios
 */
export interface MockEmailProviderSimulation {
  /**
   * Force all sends to fail with this error
   */
  forceError?: {
    code: string
    message: string
  }
  
  /**
   * Probability of random failure (0-1)
   * e.g., 0.3 means 30% chance of failure
   */
  failureRate?: number
  
  /**
   * Simulate network delay in milliseconds
   */
  delayMs?: number
  
  /**
   * Simulate specific recipient failures
   * Map of email address to error message
   */
  recipientErrors?: Record<string, string>
}

/**
 * Mock email provider options
 */
export interface MockEmailProviderOptions {
  logger?: Logger
  simulation?: MockEmailProviderSimulation
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  ok: boolean
  error?: string
  details?: Record<string, any>
}

const tracer = trace.getTracer('maritaca-mock-email-provider')

/**
 * Mock email provider implementation
 * 
 * Logs messages instead of actually sending them.
 * Supports simulation options for testing failure scenarios.
 * Includes OpenTelemetry tracing for consistency with real providers.
 * 
 * @example
 * ```typescript
 * const provider = new MockEmailProvider({
 *   simulation: {
 *     delayMs: 100,           // Simulate 100ms network delay
 *     failureRate: 0.1,       // 10% chance of random failure
 *     recipientErrors: {
 *       'bad@example.com': 'Mailbox not found',
 *     },
 *   },
 * })
 * ```
 */
export class MockEmailProvider implements Provider {
  channel = 'email' as const
  private logger: Logger
  private simulation: MockEmailProviderSimulation

  constructor(loggerOrOptions?: Logger | MockEmailProviderOptions) {
    // Handle both old (logger only) and new (options object) signatures
    if (loggerOrOptions && 'logger' in loggerOrOptions) {
      this.logger = loggerOrOptions.logger ?? createSyncLogger({ serviceName: 'maritaca-email-provider' })
      this.simulation = loggerOrOptions.simulation ?? {}
    } else {
      this.logger = (loggerOrOptions as Logger) ?? createSyncLogger({ serviceName: 'maritaca-email-provider' })
      this.simulation = {}
    }
  }

  /**
   * Update simulation settings (useful for tests)
   */
  setSimulation(simulation: MockEmailProviderSimulation): void {
    this.simulation = simulation
  }

  /**
   * Clear simulation settings
   */
  clearSimulation(): void {
    this.simulation = {}
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
  }

  /**
   * Prepare envelope for email (mock)
   * @throws {Error} If no valid recipients found
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
   * Check if the mock provider is ready (always returns ok)
   */
  async healthCheck(): Promise<HealthCheckResult> {
    return {
      ok: true,
      details: {
        mock: true,
        simulation: this.simulation,
      },
    }
  }

  /**
   * Send email (mock - just logs)
   * Supports simulation options for testing failure scenarios
   */
  async send(prepared: PreparedMessage, options?: SendOptions): Promise<ProviderResponse> {
    const startTime = Date.now()

    return tracer.startActiveSpan('mock-email.send', async (span) => {
      const { to, from, subject, text } = prepared.data
      const recipients = Array.isArray(to) ? to : [to]
      const messageId = options?.messageId

      // Add semantic span attributes for messaging operations
      span.setAttribute('messaging.system', 'mock-email')
      span.setAttribute('messaging.operation', 'send')
      span.setAttribute('messaging.destination.kind', 'email')
      span.setAttribute('to_count', recipients.length)
      span.setAttribute('from', from)
      span.setAttribute('subject', subject)
      span.setAttribute('mock', true)
      if (messageId) span.setAttribute('message.id', messageId)

      // Simulate network delay if configured
      if (this.simulation.delayMs && this.simulation.delayMs > 0) {
        span.addEvent('simulating_delay', { delayMs: this.simulation.delayMs })
        await new Promise((resolve) => setTimeout(resolve, this.simulation.delayMs))
      }

      // Check for forced error
      if (this.simulation.forceError) {
        this.logger.warn(
          {
            provider: 'mock-email',
            messageId,
            mock: true,
            simulation: 'forceError',
            error: this.simulation.forceError,
          },
          '📧 [MOCK EMAIL] Simulating forced error',
        )

        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Forced error' })
        span.end()

        // Record metrics for the simulated failure
        recordMessageSent('email', 'error')
        recordProviderError('mock-email', this.simulation.forceError.code)
        recordProcessingDuration('email', 'mock-email', Date.now() - startTime)

        return {
          success: false,
          error: this.simulation.forceError,
        }
      }

      // Check for random failure
      if (this.simulation.failureRate && Math.random() < this.simulation.failureRate) {
        this.logger.warn(
          {
            provider: 'mock-email',
            messageId,
            mock: true,
            simulation: 'randomFailure',
            failureRate: this.simulation.failureRate,
          },
          '📧 [MOCK EMAIL] Simulating random failure',
        )

        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Random failure' })
        span.end()

        // Record metrics for the simulated failure
        recordMessageSent('email', 'error')
        recordProviderError('mock-email', 'SIMULATED_RANDOM_FAILURE')
        recordProcessingDuration('email', 'mock-email', Date.now() - startTime)

        return {
          success: false,
          error: {
            code: 'SIMULATED_RANDOM_FAILURE',
            message: 'Random failure triggered by simulation',
          },
        }
      }

      // Check for recipient-specific errors
      if (this.simulation.recipientErrors) {
        const failedRecipients: string[] = []
        const successfulRecipients: string[] = []

        for (const recipient of recipients) {
          if (this.simulation.recipientErrors[recipient]) {
            failedRecipients.push(recipient)
          } else {
            successfulRecipients.push(recipient)
          }
        }

        if (failedRecipients.length > 0) {
          this.logger.warn(
            {
              provider: 'mock-email',
              messageId,
              mock: true,
              simulation: 'recipientErrors',
              failedRecipients,
              successfulRecipients,
            },
            '📧 [MOCK EMAIL] Simulating recipient-specific failures',
          )

          // If all recipients failed, return failure
          if (successfulRecipients.length === 0) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'All recipients failed' })
            span.end()

            // Record metrics for the simulated failure
            recordMessageSent('email', 'error')
            recordProviderError('mock-email', 'RECIPIENT_DELIVERY_FAILED')
            recordProcessingDuration('email', 'mock-email', Date.now() - startTime)

            return {
              success: false,
              error: {
                code: 'RECIPIENT_DELIVERY_FAILED',
                message: this.simulation.recipientErrors[failedRecipients[0]],
                details: {
                  failedRecipients,
                  errors: failedRecipients.map((r) => ({
                    recipient: r,
                    error: this.simulation.recipientErrors![r],
                  })),
                },
              },
            }
          }

          // Partial success - some recipients failed
          span.setAttribute('partialFailure', true)
          span.setStatus({ code: SpanStatusCode.OK })
          span.end()

          // Record metrics for successful send (partial success is still success)
          recordMessageSent('email', 'success')
          recordProcessingDuration('email', 'mock-email', Date.now() - startTime)

          return {
            success: true,
            data: {
              to: successfulRecipients,
              from,
              subject,
              sentAt: new Date().toISOString(),
              partialFailure: true,
              failedRecipients,
            },
            externalId: `mock-${Date.now()}`,
          }
        }
      }

      // Mock email sending - log with structured logger
      this.logger.info(
        maskLogData({
          provider: 'mock-email',
          messageId,
          mock: true,
          to,
          from,
          subject,
          bodyLength: text?.length || 0,
        }),
        '📧 [MOCK EMAIL] Sending email notification',
      )

      span.setStatus({ code: SpanStatusCode.OK })
      span.end()

      // Record metrics for successful send
      recordMessageSent('email', 'success')
      recordProcessingDuration('email', 'mock-email', Date.now() - startTime)

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
        provider: 'mock-email',
        timestamp: new Date(),
        payload: response.data,
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'email',
        provider: 'mock-email',
        timestamp: new Date(),
        payload: {
          error: response.error,
        },
      })
    }

    return events
  }
}

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
 * Mock email provider implementation
 * Logs messages instead of actually sending them
 * Supports simulation options for testing failure scenarios
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
   * Supports simulation options for testing failure scenarios
   */
  async send(prepared: PreparedMessage): Promise<ProviderResponse> {
    const { to, from, subject, text } = prepared.data
    const recipients = Array.isArray(to) ? to : [to]

    // Simulate network delay if configured
    if (this.simulation.delayMs && this.simulation.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulation.delayMs))
    }

    // Check for forced error
    if (this.simulation.forceError) {
      this.logger.warn(
        {
          provider: 'mock-email',
          mock: true,
          simulation: 'forceError',
          error: this.simulation.forceError,
        },
        '📧 [MOCK EMAIL] Simulating forced error',
      )

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
          mock: true,
          simulation: 'randomFailure',
          failureRate: this.simulation.failureRate,
        },
        '📧 [MOCK EMAIL] Simulating random failure',
      )

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
            mock: true,
            simulation: 'recipientErrors',
            failedRecipients,
            successfulRecipients,
          },
          '📧 [MOCK EMAIL] Simulating recipient-specific failures',
        )

        // If all recipients failed, return failure
        if (successfulRecipients.length === 0) {
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
      {
        provider: 'mock-email',
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

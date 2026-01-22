import { WebClient, WebAPICallResult } from '@slack/web-api'
import type {
  Provider,
  Envelope,
  PreparedMessage,
  ProviderResponse,
  MaritacaEvent,
} from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'

/**
 * Retry configuration for rate limit handling
 */
interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Slack provider implementation
 * Includes retry logic for rate limit (429) errors
 */
export class SlackProvider implements Provider {
  channel = 'slack' as const
  private retryConfig: RetryConfig

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
  }

  /**
   * Validate that the envelope can be sent via Slack
   */
  validate(envelope: Envelope): void {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    // Check if at least one recipient has Slack info
    const hasSlackRecipient = recipients.some((r) => r.slack?.userId)

    if (!hasSlackRecipient) {
      throw new Error('At least one recipient must have a Slack user ID')
    }

    // Check if Slack bot token is configured via environment variable
    if (!process.env.SLACK_BOT_TOKEN) {
      throw new Error('SLACK_BOT_TOKEN environment variable is required')
    }
  }

  /**
   * Prepare envelope for Slack API
   * Bot token is read from environment variable only (never from envelope)
   */
  prepare(envelope: Envelope): PreparedMessage {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    // Get Slack recipients
    const slackRecipients = recipients
      .filter((r) => r.slack?.userId)
      .map((r) => r.slack!.userId)

    if (slackRecipients.length === 0) {
      throw new Error('No Slack recipients found')
    }

    // Get bot token from environment only (security: never store tokens in DB)
    const botToken = process.env.SLACK_BOT_TOKEN || ''

    // Build message text
    let text = envelope.payload.text
    if (envelope.payload.title) {
      text = `*${envelope.payload.title}*\n\n${text}`
    }

    // Use custom blocks if provided, otherwise use simple text
    const blocks = envelope.overrides?.slack?.blocks || [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      },
    ]

    return {
      channel: 'slack',
      data: {
        botToken,
        userIds: slackRecipients,
        text,
        blocks,
      },
    }
  }

  /**
   * Send message via Slack API
   * Includes retry logic for rate limit (429) errors with exponential backoff
   */
  async send(prepared: PreparedMessage): Promise<ProviderResponse> {
    const { botToken, userIds, text, blocks } = prepared.data

    if (!botToken) {
      return {
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Slack bot token is required',
        },
      }
    }

    const client = new WebClient(botToken)

    try {
      // Send to each user with retry logic
      const results = await Promise.allSettled(
        userIds.map((userId: string) =>
          this.sendWithRetry(client, userId, text, blocks),
        ),
      )

      const successful = results.filter(
        (r) => r.status === 'fulfilled',
      ).length
      const failed = results.filter((r) => r.status === 'rejected').length

      if (successful === 0) {
        const firstError =
          results.find((r) => r.status === 'rejected') as PromiseRejectedResult
        return {
          success: false,
          error: {
            code: this.getErrorCode(firstError.reason),
            message: firstError.reason?.message || 'Failed to send Slack message',
            details: firstError.reason,
          },
        }
      }

      // Get message timestamps from successful sends
      const timestamps = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<any>).value.ts)

      return {
        success: true,
        data: {
          sent: successful,
          failed,
          timestamps,
        },
        externalId: timestamps[0]?.toString(),
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: this.getErrorCode(error),
          message: error.message || 'Failed to send Slack message',
          details: error,
        },
      }
    }
  }

  /**
   * Send a message to a single user with retry logic for rate limits
   */
  private async sendWithRetry(
    client: WebClient,
    userId: string,
    text: string,
    blocks: any[],
  ): Promise<WebAPICallResult> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await client.chat.postMessage({
          channel: userId,
          text,
          blocks,
        })
      } catch (error: any) {
        lastError = error

        // Check if it's a rate limit error (429)
        if (this.isRateLimitError(error)) {
          // Get retry delay from Slack's Retry-After header or use exponential backoff
          const retryAfter = this.getRetryAfter(error, attempt)
          
          if (attempt < this.retryConfig.maxRetries) {
            await sleep(retryAfter)
            continue
          }
        }

        // For non-rate-limit errors, don't retry
        throw error
      }
    }

    // Should not reach here, but throw last error if we do
    throw lastError || new Error('Max retries exceeded')
  }

  /**
   * Check if error is a rate limit (429) error
   */
  private isRateLimitError(error: any): boolean {
    // Slack SDK throws errors with code 'slack_webapi_platform_error' for API errors
    // Rate limit errors have error code 'ratelimited' or status 429
    return (
      error?.code === 'slack_webapi_rate_limited_error' ||
      error?.data?.error === 'ratelimited' ||
      error?.status === 429
    )
  }

  /**
   * Get retry delay from error or calculate exponential backoff
   */
  private getRetryAfter(error: any, attempt: number): number {
    // Try to get Retry-After from Slack's response (in seconds)
    const retryAfterSeconds = error?.retryAfter || error?.data?.retry_after
    
    if (retryAfterSeconds && typeof retryAfterSeconds === 'number') {
      // Convert to milliseconds and add small jitter
      return Math.min(
        retryAfterSeconds * 1000 + Math.random() * 100,
        this.retryConfig.maxDelayMs,
      )
    }

    // Calculate exponential backoff with jitter
    const exponentialDelay = this.retryConfig.baseDelayMs * Math.pow(2, attempt)
    const jitter = Math.random() * this.retryConfig.baseDelayMs
    
    return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelayMs)
  }

  /**
   * Get appropriate error code from error object
   */
  private getErrorCode(error: any): string {
    if (this.isRateLimitError(error)) {
      return 'SLACK_RATE_LIMITED'
    }
    return 'SLACK_API_ERROR'
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
        channel: 'slack',
        provider: 'slack',
        timestamp: new Date(),
        payload: response.data,
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'slack',
        provider: 'slack',
        timestamp: new Date(),
        payload: {
          error: response.error,
        },
      })
    }

    return events
  }
}

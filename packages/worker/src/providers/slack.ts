import { WebClient, WebAPICallResult } from '@slack/web-api'
import type { KnownBlock, Block } from '@slack/types'
import { trace, SpanStatusCode } from '@opentelemetry/api'
import type {
  Provider,
  Envelope,
  PreparedMessage,
  ProviderResponse,
  MaritacaEvent,
  SlackRecipient,
} from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'
import { LRUCache } from 'lru-cache'

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
 * Slack recipient info stored in prepared message
 */
interface SlackRecipientInfo {
  /** Direct target (userId or channelId) - can be sent directly */
  directTargets: string[]
  /** Channel names to normalize (add # prefix) */
  channelNames: string[]
  /** Emails to lookup via Slack API */
  emails: string[]
}

/**
 * Slack provider options
 */
export interface SlackProviderOptions {
  /** Retry configuration for rate limit handling */
  retryConfig?: Partial<RetryConfig>
  /** Maximum number of email->userId mappings to cache (default: 1000) */
  cacheMaxSize?: number
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtlMs?: number
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  ok: boolean
  error?: string
  details?: Record<string, any>
}

const tracer = trace.getTracer('maritaca-slack-provider')

/**
 * Slack provider implementation
 * 
 * Features:
 * - Send messages to users (DMs) or channels
 * - Lookup users by email with LRU caching
 * - Automatic retry with exponential backoff for rate limits
 * - OpenTelemetry tracing integration
 * 
 * @example
 * ```typescript
 * const provider = new SlackProvider({
 *   retryConfig: { maxRetries: 5 },
 *   cacheMaxSize: 500,
 *   cacheTtlMs: 10 * 60 * 1000, // 10 minutes
 * })
 * 
 * // Check health before sending
 * const health = await provider.healthCheck()
 * if (!health.ok) {
 *   console.error('Slack provider unhealthy:', health.error)
 * }
 * ```
 */
export class SlackProvider implements Provider {
  channel = 'slack' as const
  private retryConfig: RetryConfig
  
  /**
   * LRU cache for email -> userId lookups
   * Automatically evicts least recently used entries when full
   * and expires entries after TTL
   */
  private emailCache: LRUCache<string, string>

  constructor(options?: SlackProviderOptions) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...options?.retryConfig }
    
    this.emailCache = new LRUCache<string, string>({
      max: options?.cacheMaxSize ?? 1000,
      ttl: options?.cacheTtlMs ?? 5 * 60 * 1000, // 5 minutes default
    })
  }

  /**
   * Check if a SlackRecipient has at least one valid identifier
   */
  private hasValidSlackIdentifier(slack: SlackRecipient): boolean {
    return !!(slack.userId || slack.channelId || slack.channelName || slack.email)
  }

  /**
   * Validate that the envelope can be sent via Slack
   * @throws {Error} If validation fails
   */
  validate(envelope: Envelope): void {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    // Check if at least one recipient has valid Slack info
    const hasSlackRecipient = recipients.some(
      (r) => r.slack && this.hasValidSlackIdentifier(r.slack)
    )

    if (!hasSlackRecipient) {
      throw new Error('At least one recipient must have a Slack identifier (userId, channelId, channelName, or email)')
    }

    // Check if Slack bot token is configured via environment variable
    if (!process.env.SLACK_BOT_TOKEN) {
      throw new Error('SLACK_BOT_TOKEN environment variable is required')
    }
  }

  /**
   * Prepare envelope for Slack API
   * Bot token is read from environment variable only (never from envelope)
   * @throws {Error} If no valid recipients found
   */
  prepare(envelope: Envelope): PreparedMessage {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    // Collect all Slack recipient info
    const recipientInfo: SlackRecipientInfo = {
      directTargets: [],
      channelNames: [],
      emails: [],
    }

    for (const recipient of recipients) {
      if (!recipient.slack) continue

      const slack = recipient.slack

      // Direct targets (userId or channelId)
      if (slack.userId) {
        recipientInfo.directTargets.push(slack.userId)
      }
      if (slack.channelId) {
        recipientInfo.directTargets.push(slack.channelId)
      }

      // Channel names (need normalization)
      if (slack.channelName) {
        recipientInfo.channelNames.push(slack.channelName)
      }

      // Emails (need API lookup)
      if (slack.email) {
        recipientInfo.emails.push(slack.email)
      }
    }

    const hasRecipients = 
      recipientInfo.directTargets.length > 0 ||
      recipientInfo.channelNames.length > 0 ||
      recipientInfo.emails.length > 0

    if (!hasRecipients) {
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
    const blocks: (KnownBlock | Block)[] = envelope.overrides?.slack?.blocks || [
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
        recipientInfo,
        text,
        blocks,
      },
    }
  }

  /**
   * Normalize channel name by adding # prefix if needed
   */
  private normalizeChannelName(channelName: string): string {
    return channelName.startsWith('#') ? channelName : `#${channelName}`
  }

  /**
   * Lookup user ID by email via Slack API (with caching and retry)
   */
  private async lookupUserByEmail(client: WebClient, email: string): Promise<string> {
    const normalizedEmail = email.toLowerCase().trim()
    
    // Check cache first
    const cached = this.emailCache.get(normalizedEmail)
    if (cached) {
      return cached
    }
    
    // Cache miss - call Slack API with retry
    return this.lookupUserByEmailWithRetry(client, normalizedEmail)
  }

  /**
   * Lookup user by email with retry logic for rate limits
   */
  private async lookupUserByEmailWithRetry(client: WebClient, email: string): Promise<string> {
    return tracer.startActiveSpan('slack.lookupUserByEmail', async (span) => {
      span.setAttribute('email', email)
      
      let lastError: Error | null = null

      for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
        try {
          const response = await client.users.lookupByEmail({ email })
          
          if (!response.ok || !response.user?.id) {
            throw new Error(`User not found for email: ${email}`)
          }
          
          // Store in cache
          this.emailCache.set(email, response.user.id)
          
          span.setAttribute('userId', response.user.id)
          span.setAttribute('cacheHit', false)
          span.setStatus({ code: SpanStatusCode.OK })
          span.end()
          
          return response.user.id
        } catch (error: any) {
          lastError = error

          // Check if it's a rate limit error (429)
          if (this.isRateLimitError(error)) {
            const retryAfter = this.getRetryAfter(error, attempt)
            
            if (attempt < this.retryConfig.maxRetries) {
              span.addEvent('rate_limited', { attempt, retryAfterMs: retryAfter })
              await sleep(retryAfter)
              continue
            }
          }

          // For non-rate-limit errors or max retries exceeded, throw
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
          span.recordException(error)
          span.end()
          throw error
        }
      }

      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Max retries exceeded' })
      span.end()
      throw lastError || new Error('Max retries exceeded')
    })
  }

  /**
   * Clear the email cache (useful for testing)
   */
  clearEmailCache(): void {
    this.emailCache.clear()
  }

  /**
   * Get cache statistics (useful for monitoring)
   */
  getEmailCacheStats(): { size: number; maxSize: number; emails: string[] } {
    return {
      size: this.emailCache.size,
      maxSize: this.emailCache.max,
      emails: Array.from(this.emailCache.keys()),
    }
  }

  /**
   * Resolve all recipients to final targets
   * - Direct targets (userId, channelId) are used as-is
   * - Channel names are normalized with # prefix
   * - Emails are looked up via Slack API with caching
   */
  private async resolveTargets(
    client: WebClient,
    recipientInfo: SlackRecipientInfo,
  ): Promise<{ targets: string[]; emailLookupErrors: Array<{ email: string; error: string }> }> {
    return tracer.startActiveSpan('slack.resolveTargets', async (span) => {
      const targets: string[] = []
      const emailLookupErrors: Array<{ email: string; error: string }> = []

      // Add direct targets
      targets.push(...recipientInfo.directTargets)

      // Normalize and add channel names
      for (const channelName of recipientInfo.channelNames) {
        targets.push(this.normalizeChannelName(channelName))
      }

      // Lookup emails and add resolved user IDs
      for (const email of recipientInfo.emails) {
        try {
          const userId = await this.lookupUserByEmail(client, email)
          targets.push(userId)
        } catch (error: any) {
          emailLookupErrors.push({
            email,
            error: error.message || 'Failed to lookup user',
          })
        }
      }

      span.setAttribute('directTargets', recipientInfo.directTargets.length)
      span.setAttribute('channelNames', recipientInfo.channelNames.length)
      span.setAttribute('emails', recipientInfo.emails.length)
      span.setAttribute('resolvedTargets', targets.length)
      span.setAttribute('emailLookupErrors', emailLookupErrors.length)
      span.end()

      return { targets, emailLookupErrors }
    })
  }

  /**
   * Check if the provider is properly configured and can connect to Slack
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const botToken = process.env.SLACK_BOT_TOKEN
    
    if (!botToken) {
      return {
        ok: false,
        error: 'SLACK_BOT_TOKEN environment variable is not set',
      }
    }

    try {
      const client = new WebClient(botToken)
      const response = await client.auth.test()
      
      if (!response.ok) {
        return {
          ok: false,
          error: 'Slack authentication failed',
          details: { response },
        }
      }

      return {
        ok: true,
        details: {
          botId: response.bot_id,
          teamId: response.team_id,
          team: response.team,
          user: response.user,
        },
      }
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Failed to connect to Slack',
        details: { code: error.code },
      }
    }
  }

  /**
   * Send message via Slack API
   * Includes retry logic for rate limit (429) errors with exponential backoff
   */
  async send(prepared: PreparedMessage): Promise<ProviderResponse> {
    return tracer.startActiveSpan('slack.send', async (span) => {
      const { botToken, recipientInfo, text, blocks } = prepared.data

      if (!botToken) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Missing token' })
        span.end()
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
        // Resolve all recipients to final targets
        const { targets, emailLookupErrors } = await this.resolveTargets(client, recipientInfo)

        span.setAttribute('targetCount', targets.length)

        if (targets.length === 0) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'No valid recipients' })
          span.end()
          return {
            success: false,
            error: {
              code: 'NO_VALID_RECIPIENTS',
              message: 'No valid Slack recipients could be resolved',
              details: { emailLookupErrors },
            },
          }
        }

        // Send to each target with retry logic
        const results = await Promise.allSettled(
          targets.map((target: string) =>
            this.sendWithRetry(client, target, text, blocks),
          ),
        )

        const successful = results.filter(
          (r) => r.status === 'fulfilled',
        ).length
        const failed = results.filter((r) => r.status === 'rejected').length

        span.setAttribute('successful', successful)
        span.setAttribute('failed', failed)

        if (successful === 0) {
          const firstError =
            results.find((r) => r.status === 'rejected') as PromiseRejectedResult
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'All sends failed' })
          span.end()
          return {
            success: false,
            error: {
              code: this.getErrorCode(firstError.reason),
              message: firstError.reason?.message || 'Failed to send Slack message',
              details: { ...firstError.reason, emailLookupErrors },
            },
          }
        }

        // Get message timestamps from successful sends
        const timestamps = results
          .filter((r) => r.status === 'fulfilled')
          .map((r) => (r as PromiseFulfilledResult<any>).value.ts)

        span.setStatus({ code: SpanStatusCode.OK })
        span.end()

        return {
          success: true,
          data: {
            sent: successful,
            failed: failed + emailLookupErrors.length,
            timestamps,
            emailLookupErrors: emailLookupErrors.length > 0 ? emailLookupErrors : undefined,
          },
          externalId: timestamps[0]?.toString(),
        }
      } catch (error: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        span.recordException(error)
        span.end()
        return {
          success: false,
          error: {
            code: this.getErrorCode(error),
            message: error.message || 'Failed to send Slack message',
            details: error,
          },
        }
      }
    })
  }

  /**
   * Send a message to a single target (user or channel) with retry logic for rate limits
   */
  private async sendWithRetry(
    client: WebClient,
    target: string,
    text: string,
    blocks: (KnownBlock | Block)[],
  ): Promise<WebAPICallResult> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await client.chat.postMessage({
          channel: target,
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

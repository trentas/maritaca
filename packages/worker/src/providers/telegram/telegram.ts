import type {
  Provider,
  Envelope,
  PreparedMessage,
  ProviderResponse,
  MaritacaEvent,
  Logger,
  SendOptions,
  TelegramRecipient,
} from '@maritaca/core'
import { createId } from '@paralleldrive/cuid2'
import { createSyncLogger } from '@maritaca/core'
import { Bot } from 'grammy'
import { trace, SpanStatusCode } from '@opentelemetry/api'

/**
 * Telegram provider options
 */
export interface TelegramProviderOptions {
  logger?: Logger
  /** Telegram Bot Token (defaults to TELEGRAM_BOT_TOKEN env var) */
  botToken?: string
  /** Retry configuration */
  retryConfig?: Partial<RetryConfig>
}

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
 * Health check result
 */
export interface HealthCheckResult {
  ok: boolean
  error?: string
  details?: Record<string, any>
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const tracer = trace.getTracer('maritaca-telegram-provider')

/**
 * Telegram provider implementation
 * 
 * Sends messages via Telegram Bot API using the grammy library.
 * 
 * Features:
 * - Send messages to users, groups, or channels
 * - Support for HTML and MarkdownV2 formatting
 * - Silent notifications (disableNotification)
 * - Reply to specific messages
 * - Automatic retry with exponential backoff for rate limits
 * - OpenTelemetry tracing integration
 * 
 * Rate Limits:
 * - 30 messages/second for private chats
 * - 1 message/second for groups (20 messages/minute)
 * 
 * @see https://core.telegram.org/bots/api
 * @see https://grammy.dev/
 * 
 * @example
 * ```typescript
 * const provider = new TelegramProvider({
 *   botToken: process.env.TELEGRAM_BOT_TOKEN,
 * })
 * 
 * // Check health
 * const health = await provider.healthCheck()
 * if (!health.ok) {
 *   console.error('Telegram provider unhealthy:', health.error)
 * }
 * ```
 */
export class TelegramProvider implements Provider {
  channel = 'telegram' as const
  private logger: Logger
  private bot: Bot
  private botToken: string
  private retryConfig: RetryConfig

  constructor(options?: TelegramProviderOptions) {
    this.logger = options?.logger ?? createSyncLogger({ serviceName: 'maritaca-telegram-provider' })
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...options?.retryConfig }

    const botToken = options?.botToken ?? process.env.TELEGRAM_BOT_TOKEN

    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is required for TelegramProvider')
    }

    this.botToken = botToken
    this.bot = new Bot(botToken)
  }

  /**
   * Check if a TelegramRecipient has a valid identifier
   */
  private hasValidTelegramIdentifier(telegram: TelegramRecipient): boolean {
    return telegram.chatId !== undefined && telegram.chatId !== null && telegram.chatId !== ''
  }

  /**
   * Validate that the envelope can be sent via Telegram
   */
  validate(envelope: Envelope): void {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    const hasTelegramRecipient = recipients.some(
      (r) => r.telegram && this.hasValidTelegramIdentifier(r.telegram)
    )

    if (!hasTelegramRecipient) {
      throw new Error('At least one recipient must have a Telegram chat ID')
    }

    if (!this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is required')
    }
  }

  /**
   * Prepare envelope for Telegram API
   */
  prepare(envelope: Envelope): PreparedMessage {
    const recipients = Array.isArray(envelope.recipient)
      ? envelope.recipient
      : [envelope.recipient]

    const chatIds: (string | number)[] = recipients
      .filter((r) => r.telegram && this.hasValidTelegramIdentifier(r.telegram))
      .map((r) => r.telegram!.chatId)

    if (chatIds.length === 0) {
      throw new Error('No Telegram recipients found')
    }

    // Build message text
    let text = envelope.payload.text
    if (envelope.payload.title) {
      text = `<b>${envelope.payload.title}</b>\n\n${text}`
    }

    // Get Telegram-specific overrides
    const overrides = envelope.overrides?.telegram

    return {
      channel: 'telegram',
      data: {
        chatIds,
        text,
        parseMode: overrides?.parseMode ?? 'HTML',
        disableNotification: overrides?.disableNotification ?? false,
        replyToMessageId: overrides?.replyToMessageId,
      },
    }
  }

  /**
   * Check if the provider is properly configured and can connect to Telegram
   */
  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.botToken) {
      return {
        ok: false,
        error: 'TELEGRAM_BOT_TOKEN environment variable is not set',
      }
    }

    try {
      const me = await this.bot.api.getMe()

      return {
        ok: true,
        details: {
          botId: me.id,
          botUsername: me.username,
          firstName: me.first_name,
          canJoinGroups: me.can_join_groups,
          canReadGroupMessages: me.can_read_all_group_messages,
        },
      }
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Failed to connect to Telegram',
        details: { code: error.error_code },
      }
    }
  }

  /**
   * Send message via Telegram API
   */
  async send(prepared: PreparedMessage, options?: SendOptions): Promise<ProviderResponse> {
    return tracer.startActiveSpan('telegram.send', async (span) => {
      const { chatIds, text, parseMode, disableNotification, replyToMessageId } = prepared.data
      const messageId = options?.messageId

      span.setAttribute('recipient_count', chatIds.length)
      span.setAttribute('channel', 'telegram')
      if (messageId) span.setAttribute('message.id', messageId)

      try {
        const results = await Promise.allSettled(
          chatIds.map((chatId: string | number) =>
            this.sendWithRetry(chatId, text, parseMode, disableNotification, replyToMessageId, messageId)
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

          return {
            success: false,
            error: {
              code: this.getErrorCode(firstError.reason),
              message: firstError.reason?.message || 'Failed to send Telegram message',
              details: {
                errorCode: firstError.reason?.error_code,
                description: firstError.reason?.description,
              },
            },
          }
        }

        const messageIds = results
          .filter((r) => r.status === 'fulfilled')
          .map((r) => (r as PromiseFulfilledResult<number>).value)

        span.setStatus({ code: SpanStatusCode.OK })
        span.end()

        return {
          success: true,
          data: {
            sent: successful,
            failed,
            messageIds,
          },
          externalId: messageIds[0]?.toString(),
        }
      } catch (error: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        span.recordException(error)
        span.end()

        return {
          success: false,
          error: {
            code: 'TELEGRAM_EXCEPTION',
            message: error.message,
          },
        }
      }
    })
  }

  /**
   * Send message to a single chat with retry logic for rate limits
   */
  private async sendWithRetry(
    chatId: string | number,
    text: string,
    parseMode: 'HTML' | 'MarkdownV2',
    disableNotification: boolean,
    replyToMessageId: number | undefined,
    messageId: string | undefined,
  ): Promise<number> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        this.logger.info(
          {
            provider: 'telegram',
            messageId,
            chatId: typeof chatId === 'string' ? chatId : chatId.toString(),
            attempt: attempt > 0 ? attempt : undefined,
          },
          '📨 [TELEGRAM] Sending message',
        )

        const result = await this.bot.api.sendMessage(chatId, text, {
          parse_mode: parseMode,
          disable_notification: disableNotification,
          reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
        })

        this.logger.info(
          {
            provider: 'telegram',
            messageId,
            externalId: result.message_id,
            chatId: typeof chatId === 'string' ? chatId : chatId.toString(),
          },
          '📨 [TELEGRAM] Message sent successfully',
        )

        return result.message_id
      } catch (error: any) {
        lastError = error

        // Check if it's a rate limit error (429)
        if (this.isRateLimitError(error)) {
          const retryAfter = this.getRetryAfter(error, attempt)

          if (attempt < this.retryConfig.maxRetries) {
            this.logger.warn(
              {
                provider: 'telegram',
                messageId,
                chatId: typeof chatId === 'string' ? chatId : chatId.toString(),
                retryAfter,
                attempt,
              },
              '📨 [TELEGRAM] Rate limited, retrying...',
            )
            await sleep(retryAfter)
            continue
          }
        }

        // For non-rate-limit errors, don't retry
        throw error
      }
    }

    throw lastError || new Error('Max retries exceeded')
  }

  /**
   * Check if error is a rate limit (429) error
   */
  private isRateLimitError(error: any): boolean {
    return (
      error?.error_code === 429 ||
      error?.message?.includes('Too Many Requests') ||
      error?.description?.includes('Too Many Requests')
    )
  }

  /**
   * Get retry delay from error or calculate exponential backoff
   */
  private getRetryAfter(error: any, attempt: number): number {
    // Try to get retry_after from Telegram's response (in seconds)
    const retryAfterSeconds = error?.parameters?.retry_after

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
      return 'TELEGRAM_RATE_LIMITED'
    }
    if (error?.error_code === 400) {
      return 'TELEGRAM_BAD_REQUEST'
    }
    if (error?.error_code === 401) {
      return 'TELEGRAM_UNAUTHORIZED'
    }
    if (error?.error_code === 403) {
      return 'TELEGRAM_FORBIDDEN'
    }
    if (error?.error_code === 404) {
      return 'TELEGRAM_NOT_FOUND'
    }
    return 'TELEGRAM_API_ERROR'
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
        channel: 'telegram',
        provider: 'telegram',
        timestamp: new Date(),
        payload: response.data,
      })
    } else {
      events.push({
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'telegram',
        provider: 'telegram',
        timestamp: new Date(),
        payload: {
          error: response.error,
        },
      })
    }

    return events
  }
}

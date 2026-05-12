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
import { createSyncLogger, isFatalProviderError } from '@maritaca/core'

export interface FailoverEmailProviderOptions {
  /** Ordered list of providers — index 0 is primary, the rest are fallbacks. Must contain at least one entry. */
  providers: Provider[]
  logger?: Logger
}

/**
 * Email provider that delegates to an ordered chain of underlying providers.
 *
 * On `send()` it tries the primary; if the response indicates a non-fatal failure,
 * it walks down the chain until one succeeds or the chain is exhausted. `validate`
 * and `prepare` delegate to the primary — email providers in this repo accept the
 * same prepared shape (to / from / subject / text / html), so the primary's
 * prepared message is fed into every fallback's `send()`.
 *
 * Per-provider metrics (errors, durations, rate limits) are still recorded
 * inside each underlying provider, so observability is unchanged. The dispatcher
 * adds structured logs describing which provider actually delivered.
 */
export class FailoverEmailProvider implements Provider {
  channel = 'email' as const
  name: string
  private logger: Logger
  private providers: Provider[]

  constructor(options: FailoverEmailProviderOptions) {
    if (!options.providers || options.providers.length === 0) {
      throw new Error('FailoverEmailProvider requires at least one provider')
    }
    this.providers = options.providers
    this.logger = options.logger ?? createSyncLogger({ serviceName: 'maritaca-failover-email-provider' })
    this.name = `failover(${this.providers.map((p) => p.name).join(',')})`
  }

  validate(envelope: Envelope): void {
    this.providers[0].validate(envelope)
  }

  prepare(envelope: Envelope): PreparedMessage {
    return this.providers[0].prepare(envelope)
  }

  async send(prepared: PreparedMessage, options?: SendOptions): Promise<ProviderResponse> {
    let lastResponse: ProviderResponse | null = null
    const attemptsLog: Array<{ provider: string; success: boolean; code?: string; message?: string }> = []

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]
      const isLast = i === this.providers.length - 1

      try {
        const response = await provider.send(prepared, options)

        if (response.success) {
          attemptsLog.push({ provider: provider.name, success: true })

          if (i > 0) {
            this.logger.info(
              { messageId: options?.messageId, deliveredBy: provider.name, attempts: attemptsLog },
              '📧 [FAILOVER] Email delivered via fallback provider',
            )
          }

          return {
            ...response,
            data: { ...(response.data ?? {}), providerUsed: provider.name, failoverAttempts: attemptsLog },
          }
        }

        attemptsLog.push({
          provider: provider.name,
          success: false,
          code: response.error?.code,
          message: response.error?.message,
        })
        lastResponse = response

        if (isFatalProviderError(response.error)) {
          this.logger.warn(
            { messageId: options?.messageId, provider: provider.name, error: response.error },
            '📧 [FAILOVER] Fatal provider error — not retrying with fallback',
          )
          break
        }

        if (!isLast) {
          this.logger.warn(
            { messageId: options?.messageId, provider: provider.name, error: response.error, nextProvider: this.providers[i + 1].name },
            '📧 [FAILOVER] Provider failed, trying next',
          )
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        attemptsLog.push({ provider: provider.name, success: false, code: 'PROVIDER_EXCEPTION', message })
        lastResponse = {
          success: false,
          error: { code: 'PROVIDER_EXCEPTION', message },
        }

        if (!isLast) {
          this.logger.warn(
            { messageId: options?.messageId, provider: provider.name, error: message, nextProvider: this.providers[i + 1].name },
            '📧 [FAILOVER] Provider threw exception, trying next',
          )
        }
      }
    }

    this.logger.error(
      { messageId: options?.messageId, attempts: attemptsLog },
      '📧 [FAILOVER] All providers failed',
    )

    return {
      success: false,
      error: {
        code: lastResponse?.error?.code ?? 'FAILOVER_EXHAUSTED',
        message: lastResponse?.error?.message ?? 'All configured email providers failed',
        details: { attempts: attemptsLog, ...(lastResponse?.error?.details ?? {}) },
      },
    }
  }

  mapEvents(response: ProviderResponse, messageId: string): MaritacaEvent[] {
    const provider = (response.data?.providerUsed as string | undefined) ?? this.providers[0].name

    if (response.success) {
      return [
        {
          id: createId(),
          type: 'attempt.succeeded',
          messageId,
          channel: 'email',
          provider,
          timestamp: new Date(),
          payload: { ...response.data, externalId: response.externalId },
        },
      ]
    }

    return [
      {
        id: createId(),
        type: 'attempt.failed',
        messageId,
        channel: 'email',
        provider,
        timestamp: new Date(),
        payload: { error: response.error },
      },
    ]
  }
}

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

const ENVELOPE_KEY = '__failoverEnvelope'

interface FailoverPreparedData {
  [ENVELOPE_KEY]: Envelope
}

/**
 * Email provider that delegates to an ordered chain of underlying providers.
 *
 * `prepare()` stashes the envelope inside the returned `PreparedMessage`.
 * `send()` then calls each child provider's own `prepare()` on demand, so each
 * fallback receives a payload in its native shape (Resend/SES use a combined
 * `from` string, Mandrill splits `from_email` / `from_name`). Without this
 * per-provider re-prepare, a chain with mixed shapes — e.g. `resend,mandrill`
 * — would send an incomplete payload to the fallback.
 *
 * Failover walks the chain on transient failures and short-circuits on fatal
 * errors (codes in {@link FATAL_ERROR_CODES} from `@maritaca/core`). Per-provider
 * metrics are still recorded inside each underlying provider; the dispatcher
 * only adds structured logs describing which provider actually delivered.
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
    // Validate against every provider so a chain misconfiguration surfaces
    // before we attempt to send. Each provider has its own constraints
    // (e.g. Resend requires a sender email; Mock does not).
    for (const provider of this.providers) {
      provider.validate(envelope)
    }
  }

  prepare(envelope: Envelope): PreparedMessage {
    return {
      channel: 'email',
      data: { [ENVELOPE_KEY]: envelope } satisfies FailoverPreparedData,
    }
  }

  async send(prepared: PreparedMessage, options?: SendOptions): Promise<ProviderResponse> {
    const envelope = (prepared.data as Partial<FailoverPreparedData>)[ENVELOPE_KEY]
    if (!envelope) {
      return {
        success: false,
        error: {
          code: 'FAILOVER_MISSING_ENVELOPE',
          message: 'FailoverEmailProvider.send was called with a prepared message that did not go through its prepare()',
        },
      }
    }

    let lastResponse: ProviderResponse | null = null
    const attemptsLog: Array<{ provider: string; success: boolean; code?: string; message?: string }> = []

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]
      const isLast = i === this.providers.length - 1

      try {
        const subPrepared = provider.prepare(envelope)
        const response = await provider.send(subPrepared, options)

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

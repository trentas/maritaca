import type { Provider, Logger, EmailProviderType } from '@maritaca/core'
import { createSyncLogger } from '@maritaca/core'
import { MockEmailProvider } from './mock.js'
import { ResendProvider } from './resend.js'
import { SESProvider } from './ses.js'
import { MandrillProvider } from './mandrill.js'
import { FailoverEmailProvider } from './failover.js'

/**
 * Health check result (common to all providers)
 */
export interface HealthCheckResult {
  ok: boolean
  error?: string
  details?: Record<string, any>
}

/**
 * Options for creating an email provider
 */
export interface CreateEmailProviderOptions {
  logger?: Logger
}

const KNOWN_TYPES: ReadonlySet<EmailProviderType> = new Set(['resend', 'ses', 'mandrill', 'mock'])

function instantiate(type: EmailProviderType, options?: CreateEmailProviderOptions): Provider {
  switch (type) {
    case 'resend':
      return new ResendProvider({ logger: options?.logger })
    case 'ses':
      return new SESProvider({ logger: options?.logger })
    case 'mandrill':
      return new MandrillProvider({ logger: options?.logger })
    case 'mock':
      return new MockEmailProvider({ logger: options?.logger })
  }
}

function parseChain(value: string | undefined): EmailProviderType[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is EmailProviderType => KNOWN_TYPES.has(s as EmailProviderType))
}

/**
 * Factory for the email provider used by the worker.
 *
 * Resolution order:
 *  1. Explicit `providerType` argument (typically from `envelope.overrides.email.provider`)
 *     → returns a single provider. Misconfiguration throws (caller asked for it explicitly).
 *  2. `EMAIL_PROVIDERS=resend,mandrill` env (comma-separated, ordered)
 *     → returns a {@link FailoverEmailProvider}. Providers that fail to construct
 *     (e.g. missing API key) are skipped with a warning instead of crashing the worker,
 *     since the whole point of the chain is resilience.
 *  3. `EMAIL_PROVIDER=resend` env → single provider (backwards-compatible). Strict.
 *  4. Falls back to `mock`.
 */
export function createEmailProvider(
  providerType?: EmailProviderType | null,
  options?: CreateEmailProviderOptions,
): Provider {
  if (providerType) {
    return instantiate(providerType, options)
  }

  const logger = options?.logger ?? createSyncLogger({ serviceName: 'maritaca-email-factory' })

  const chain = parseChain(process.env.EMAIL_PROVIDERS)
  if (chain.length > 1) {
    const built: Provider[] = []
    for (const type of chain) {
      try {
        built.push(instantiate(type, options))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        logger.warn(
          { provider: type, error: message },
          '📧 [EMAIL FACTORY] Skipping provider in EMAIL_PROVIDERS chain — failed to construct',
        )
      }
    }

    if (built.length === 0) {
      logger.error(
        { chain },
        '📧 [EMAIL FACTORY] No usable providers in EMAIL_PROVIDERS chain — falling back to mock',
      )
      return new MockEmailProvider({ logger: options?.logger })
    }

    if (built.length === 1) {
      logger.warn(
        { used: built[0].name, chain },
        '📧 [EMAIL FACTORY] Only one provider in EMAIL_PROVIDERS chain is usable — failover degraded to single provider',
      )
      return built[0]
    }

    return new FailoverEmailProvider({ providers: built, logger: options?.logger })
  }
  if (chain.length === 1) {
    return instantiate(chain[0], options)
  }

  const singleType = (process.env.EMAIL_PROVIDER as EmailProviderType | undefined) ?? 'mock'
  return instantiate(KNOWN_TYPES.has(singleType) ? singleType : 'mock', options)
}

export { MockEmailProvider } from './mock.js'
export type { MockEmailProviderSimulation, MockEmailProviderOptions } from './mock.js'

export { ResendProvider } from './resend.js'
export type { ResendProviderOptions } from './resend.js'

export { SESProvider } from './ses.js'
export type { SESProviderOptions } from './ses.js'

export { MandrillProvider } from './mandrill.js'
export type { MandrillProviderOptions } from './mandrill.js'

export { FailoverEmailProvider } from './failover.js'
export type { FailoverEmailProviderOptions } from './failover.js'

// Re-export shared EmailProviderType so worker imports keep working without churn
export type { EmailProviderType } from '@maritaca/core'

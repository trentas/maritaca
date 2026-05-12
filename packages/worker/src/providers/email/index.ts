import type { Provider, Logger, EmailProviderType } from '@maritaca/core'
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
 *     → returns a single provider.
 *  2. `EMAIL_PROVIDERS=resend,mandrill` env (comma-separated, ordered)
 *     → returns a {@link FailoverEmailProvider} that tries primary then fallbacks.
 *  3. `EMAIL_PROVIDER=resend` env → single provider (backwards-compatible).
 *  4. Falls back to `mock`.
 */
export function createEmailProvider(
  providerType?: EmailProviderType | null,
  options?: CreateEmailProviderOptions,
): Provider {
  if (providerType) {
    return instantiate(providerType, options)
  }

  const chain = parseChain(process.env.EMAIL_PROVIDERS)
  if (chain.length > 1) {
    return new FailoverEmailProvider({
      providers: chain.map((t) => instantiate(t, options)),
      logger: options?.logger,
    })
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

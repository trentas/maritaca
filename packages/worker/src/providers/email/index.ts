import type { Provider, Logger } from '@maritaca/core'
import { MockEmailProvider } from './mock.js'
import { ResendProvider } from './resend.js'
import { SESProvider } from './ses.js'

/**
 * Email provider types
 */
export type EmailProviderType = 'resend' | 'ses' | 'mock'

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

/**
 * Factory function to create the appropriate email provider
 * 
 * @param providerType - The type of email provider to create
 * @param options - Options to pass to the provider
 * @returns The email provider instance
 * 
 * @example
 * ```typescript
 * // Use environment variable EMAIL_PROVIDER
 * const provider = createEmailProvider()
 * 
 * // Explicitly specify provider
 * const resendProvider = createEmailProvider('resend')
 * const sesProvider = createEmailProvider('ses')
 * const mockProvider = createEmailProvider('mock')
 * ```
 */
export function createEmailProvider(
  providerType?: EmailProviderType | null,
  options?: CreateEmailProviderOptions,
): Provider {
  // Determine provider type from parameter or environment variable
  const type = providerType ?? (process.env.EMAIL_PROVIDER as EmailProviderType) ?? 'mock'

  switch (type) {
    case 'resend':
      return new ResendProvider({ logger: options?.logger })
    
    case 'ses':
      return new SESProvider({ logger: options?.logger })
    
    case 'mock':
    default:
      return new MockEmailProvider({ logger: options?.logger })
  }
}

// Re-export all providers and types
export { MockEmailProvider } from './mock.js'
export type { MockEmailProviderSimulation, MockEmailProviderOptions } from './mock.js'

export { ResendProvider } from './resend.js'
export type { ResendProviderOptions } from './resend.js'

export { SESProvider } from './ses.js'
export type { SESProviderOptions } from './ses.js'

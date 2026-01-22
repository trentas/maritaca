import type { Provider, Channel, Logger, EmailProviderType } from '@maritaca/core'
import { SlackProvider } from './slack.js'
import { createEmailProvider } from './email/index.js'
import { createSmsProvider } from './sms/index.js'
import { createPushProvider } from './push/index.js'

/**
 * Provider registry - singleton instances of providers
 * Avoids creating new provider instances for each job
 */
class ProviderRegistry {
  private providers: Map<string, Provider> = new Map()
  private logger?: Logger

  /**
   * Initialize the registry with a logger
   */
  initialize(logger?: Logger): void {
    this.logger = logger
  }

  /**
   * Get provider instance for a channel
   * Creates singleton instance on first access
   * 
   * @param channel - The channel to get provider for
   * @param emailProvider - Optional email provider type (for email channel)
   */
  getProvider(channel: Channel, emailProvider?: EmailProviderType): Provider | null {
    // Build cache key - for email, include provider type
    const cacheKey = channel === 'email' && emailProvider 
      ? `email:${emailProvider}` 
      : channel

    // Return cached provider if exists
    if (this.providers.has(cacheKey)) {
      return this.providers.get(cacheKey)!
    }

    // Create provider based on channel
    let provider: Provider | null = null

    switch (channel) {
      case 'slack':
        provider = new SlackProvider()
        break
      case 'email':
        provider = createEmailProvider(emailProvider, { logger: this.logger })
        break
      case 'sms':
        provider = createSmsProvider(null, { logger: this.logger })
        break
      case 'push':
        provider = createPushProvider(null, { logger: this.logger })
        break
      case 'web':
        // Not implemented yet
        provider = null
        break
      default:
        provider = null
    }

    // Cache the provider if created
    if (provider) {
      this.providers.set(cacheKey, provider)
    }

    return provider
  }

  /**
   * Clear all cached providers (useful for testing)
   */
  clear(): void {
    this.providers.clear()
  }
}

// Export singleton instance
export const providerRegistry = new ProviderRegistry()

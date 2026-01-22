import type { Provider, Channel, Logger } from '@maritaca/core'
import { SlackProvider } from './slack.js'
import { EmailProvider } from './email.js'

/**
 * Provider registry - singleton instances of providers
 * Avoids creating new provider instances for each job
 */
class ProviderRegistry {
  private providers: Map<Channel, Provider> = new Map()
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
   */
  getProvider(channel: Channel): Provider | null {
    // Return cached provider if exists
    if (this.providers.has(channel)) {
      return this.providers.get(channel)!
    }

    // Create provider based on channel
    let provider: Provider | null = null

    switch (channel) {
      case 'slack':
        provider = new SlackProvider()
        break
      case 'email':
        provider = new EmailProvider(this.logger)
        break
      case 'push':
      case 'web':
      case 'sms':
        // Not implemented yet
        provider = null
        break
      default:
        provider = null
    }

    // Cache the provider if created
    if (provider) {
      this.providers.set(channel, provider)
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

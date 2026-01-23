import type { Provider, Logger } from '@maritaca/core'
import { TelegramProvider } from './telegram.js'

/**
 * Factory function to create a Telegram provider
 * 
 * @param options - Options to pass to the provider
 * @returns The Telegram provider instance
 */
export function createTelegramProvider(options?: { logger?: Logger }): Provider {
  return new TelegramProvider({
    logger: options?.logger,
  })
}

export { TelegramProvider } from './telegram.js'
export type { TelegramProviderOptions, HealthCheckResult } from './telegram.js'

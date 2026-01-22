import type { Provider, Logger } from '@maritaca/core'
import { SnsPushProvider } from './sns.js'

/**
 * Push provider types
 */
export type PushProviderType = 'sns'

/**
 * Options for creating a push provider
 */
export interface CreatePushProviderOptions {
  logger?: Logger
}

/**
 * Factory function to create the appropriate push provider
 * 
 * @param providerType - The type of push provider to create
 * @param options - Options to pass to the provider
 * @returns The push provider instance
 */
export function createPushProvider(
  providerType?: PushProviderType | null,
  options?: CreatePushProviderOptions,
): Provider {
  const type = providerType ?? (process.env.PUSH_PROVIDER as PushProviderType) ?? 'sns'

  switch (type) {
    case 'sns':
    default:
      return new SnsPushProvider({ logger: options?.logger })
  }
}

export { SnsPushProvider } from './sns.js'
export type { SnsPushProviderOptions } from './sns.js'

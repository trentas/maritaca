import type { Provider, Logger } from '@maritaca/core'
import { WebPushProvider } from './webpush.js'

/**
 * Web provider types
 */
export type WebProviderType = 'webpush'

/**
 * Options for creating a web provider
 */
export interface CreateWebProviderOptions {
  logger?: Logger
}

/**
 * Factory function to create the appropriate web push provider
 * 
 * @param providerType - The type of web provider to create
 * @param options - Options to pass to the provider
 * @returns The web provider instance
 */
export function createWebProvider(
  providerType?: WebProviderType | null,
  options?: CreateWebProviderOptions,
): Provider {
  const type = providerType ?? (process.env.WEB_PROVIDER as WebProviderType) ?? 'webpush'

  switch (type) {
    case 'webpush':
    default:
      return new WebPushProvider({ logger: options?.logger })
  }
}

export { WebPushProvider } from './webpush.js'
export type { WebPushProviderOptions } from './webpush.js'

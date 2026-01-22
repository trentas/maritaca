import type { Provider, Logger, SmsProviderType } from '@maritaca/core'
import { SnsSmsProvider } from './sns.js'
import { TwilioProvider } from '../twilio/twilio.js'

/**
 * Options for creating an SMS provider
 */
export interface CreateSmsProviderOptions {
  logger?: Logger
}

/**
 * Factory function to create the appropriate SMS provider
 * 
 * @param providerType - The type of SMS provider to create: 'sns' or 'twilio'
 * @param options - Options to pass to the provider
 * @returns The SMS provider instance
 */
export function createSmsProvider(
  providerType?: SmsProviderType | null,
  options?: CreateSmsProviderOptions,
): Provider {
  const type = providerType ?? (process.env.SMS_PROVIDER as SmsProviderType) ?? 'sns'

  switch (type) {
    case 'twilio':
      return new TwilioProvider({ channel: 'sms', logger: options?.logger })
    case 'sns':
    default:
      return new SnsSmsProvider({ logger: options?.logger })
  }
}

export { SnsSmsProvider } from './sns.js'
export type { SnsSmsProviderOptions } from './sns.js'
export type { SmsProviderType } from '@maritaca/core'

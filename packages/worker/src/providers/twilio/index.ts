import type { Provider, Logger } from '@maritaca/core'
import { TwilioProvider } from './twilio.js'

/**
 * Factory function to create a Twilio SMS provider
 * 
 * @param options - Options to pass to the provider
 * @returns The Twilio SMS provider instance
 */
export function createTwilioSmsProvider(options?: { logger?: Logger }): Provider {
  return new TwilioProvider({ 
    channel: 'sms',
    logger: options?.logger,
  })
}

/**
 * Factory function to create a Twilio WhatsApp provider
 * 
 * @param options - Options to pass to the provider
 * @returns The Twilio WhatsApp provider instance
 */
export function createTwilioWhatsAppProvider(options?: { logger?: Logger }): Provider {
  return new TwilioProvider({
    channel: 'whatsapp',
    logger: options?.logger,
  })
}

export { TwilioProvider } from './twilio.js'
export type { TwilioProviderOptions } from './twilio.js'

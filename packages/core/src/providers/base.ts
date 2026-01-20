import type { Channel } from '../types/envelope.js'
import type { Envelope } from '../types/envelope.js'
import type { PreparedMessage, ProviderResponse } from './types.js'
import type { MaritacaEvent } from '../types/event.js'

/**
 * Base interface for all notification providers
 * Providers transform envelopes into actual API calls to external services
 */
export interface Provider {
  /** Channel this provider handles */
  channel: Channel

  /**
   * Validate that the envelope can be processed by this provider
   * @param envelope - The message envelope to validate
   * @throws {Error} If the envelope is invalid for this provider
   */
  validate(envelope: Envelope): void

  /**
   * Prepare the envelope for sending by transforming it into provider-specific format
   * @param envelope - The message envelope to prepare
   * @returns Prepared message ready to be sent
   */
  prepare(envelope: Envelope): PreparedMessage

  /**
   * Send the prepared message to the external service
   * @param prepared - The prepared message
   * @returns Provider response with success status and details
   */
  send(prepared: PreparedMessage): Promise<ProviderResponse>

  /**
   * Map provider response to Maritaca events
   * @param response - The provider response
   * @param messageId - The message ID this response relates to
   * @returns Array of events to emit
   */
  mapEvents(response: ProviderResponse, messageId: string): MaritacaEvent[]
}

import type { Channel } from '../types/envelope.js'
import type { Envelope } from '../types/envelope.js'

/**
 * Prepared message ready to be sent by a provider
 */
export interface PreparedMessage {
  /** Channel this message is for */
  channel: Channel
  /** Provider-specific prepared data */
  data: Record<string, any>
}

/**
 * Response from a provider after sending
 */
export interface ProviderResponse {
  /** Whether the send was successful */
  success: boolean
  /** Provider-specific response data */
  data?: Record<string, any>
  /** Error information if send failed */
  error?: {
    code?: string
    message: string
    details?: Record<string, any>
  }
  /** External provider message ID (if available) */
  externalId?: string
}

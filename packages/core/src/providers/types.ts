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
 * Options for sending a message
 */
export interface SendOptions {
  /** Message ID for tracing/logging */
  messageId?: string
  /** Per-tenant credentials from integration store (null = use env fallback) */
  credentials?: Record<string, string> | null
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
  /**
   * Name of the underlying provider that actually handled the request.
   * Dispatcher/proxy providers (e.g. failover) set this to the chosen
   * child provider's name so persistence layers can record the real
   * deliverer instead of the wrapper. Plain providers leave it unset.
   */
  provider?: string
}

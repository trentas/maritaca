import type { Envelope } from '@maritaca/core'
import {
  MaritacaError,
  MaritacaAPIError,
  MaritacaNetworkError,
} from '../errors.js'

export interface SendMessageResponse {
  messageId: string
  status: string
  channels: string[]
}

export interface GetMessageResponse {
  id: string
  status: string
  envelope: Envelope
  events: Array<{
    id: string
    type: string
    channel?: string
    provider?: string
    payload?: any
    createdAt: Date
  }>
}

/**
 * Messages API client
 */
export class MessagesAPI {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  /**
   * Send a message
   */
  async send(envelope: Envelope): Promise<SendMessageResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(envelope),
      })

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as Record<string, any>
        throw new MaritacaAPIError(
          errorData.message || 'Failed to send message',
          response.status,
          errorData,
        )
      }

      return (await response.json()) as SendMessageResponse
    } catch (error: any) {
      if (error instanceof MaritacaAPIError) {
        throw error
      }

      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new MaritacaNetworkError(
          'Network error: Failed to connect to Maritaca API',
          error,
        )
      }

      throw new MaritacaError(
        error.message || 'Unknown error occurred',
        'UNKNOWN_ERROR',
      )
    }
  }

  /**
   * Get message by ID
   */
  async get(messageId: string): Promise<GetMessageResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages/${messageId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new MaritacaAPIError('Message not found', 404)
        }

        const errorData = (await response.json().catch(() => ({}))) as Record<string, any>
        throw new MaritacaAPIError(
          errorData.message || 'Failed to get message',
          response.status,
          errorData,
        )
      }

      return (await response.json()) as GetMessageResponse
    } catch (error: any) {
      if (error instanceof MaritacaAPIError) {
        throw error
      }

      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new MaritacaNetworkError(
          'Network error: Failed to connect to Maritaca API',
          error,
        )
      }

      throw new MaritacaError(
        error.message || 'Unknown error occurred',
        'UNKNOWN_ERROR',
      )
    }
  }
}

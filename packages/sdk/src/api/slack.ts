import {
  MaritacaError,
  MaritacaAPIError,
  MaritacaNetworkError,
} from '../errors.js'

export interface ResolveChannelResponse {
  channelId: string
  channelName: string
  isPrivate: boolean
  isMember: boolean
}

export interface JoinChannelResponse {
  channelId: string
  channelName?: string
  joined: boolean
  alreadyMember: boolean
}

/**
 * Slack integration API client.
 *
 * Resolve channel names to rename-proof IDs and have the bot join public
 * channels — the recommended setup flow before delivering by `channelId`.
 */
export class SlackAPI {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async request<T>(path: string, init: RequestInit, fallbackMessage: string): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...init.headers,
        },
      })

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as Record<string, any>
        throw new MaritacaAPIError(errorData.message || fallbackMessage, response.status, errorData)
      }

      return (await response.json()) as T
    } catch (error: any) {
      if (error instanceof MaritacaAPIError) {
        throw error
      }
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new MaritacaNetworkError('Network error: Failed to connect to Maritaca API', error)
      }
      throw new MaritacaError(error.message || 'Unknown error occurred', 'UNKNOWN_ERROR')
    }
  }

  /**
   * Resolve a Slack channel name to its canonical channel ID.
   * Throws MaritacaAPIError with status 404 when the channel is not found.
   */
  async resolveChannel(channelName: string): Promise<ResolveChannelResponse> {
    return this.request<ResolveChannelResponse>(
      '/v1/integrations/slack/channels/resolve',
      { method: 'POST', body: JSON.stringify({ channelName }) },
      'Failed to resolve Slack channel',
    )
  }

  /**
   * Ask the bot to join a public channel (idempotent).
   * Throws MaritacaAPIError with status 403 for private channels.
   */
  async joinChannel(channelId: string): Promise<JoinChannelResponse> {
    return this.request<JoinChannelResponse>(
      `/v1/integrations/slack/channels/${encodeURIComponent(channelId)}/join`,
      { method: 'POST' },
      'Failed to join Slack channel',
    )
  }
}

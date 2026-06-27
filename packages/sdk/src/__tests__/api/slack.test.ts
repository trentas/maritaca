import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SlackAPI } from '../../api/slack.js'
import { MaritacaAPIError } from '../../errors.js'

global.fetch = vi.fn()

describe('Slack API', () => {
  let api: SlackAPI

  beforeEach(() => {
    api = new SlackAPI('http://localhost:7377', 'test-key')
    vi.clearAllMocks()
  })

  describe('resolveChannel', () => {
    it('resolves a channel name to its ID', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ channelId: 'C08ABC', channelName: 'alerts', isPrivate: false, isMember: true }),
      } as Response)

      const result = await api.resolveChannel('alerts')
      expect(result.channelId).toBe('C08ABC')
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:7377/v1/integrations/slack/channels/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ channelName: 'alerts' }),
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        }),
      )
    })

    it('throws MaritacaAPIError with statusCode on a 404', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not Found', message: 'Channel not found' }),
      } as Response)

      await expect(api.resolveChannel('ghost')).rejects.toBeInstanceOf(MaritacaAPIError)
      await expect(api.resolveChannel('ghost')).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('joinChannel', () => {
    it('joins a public channel by ID', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ channelId: 'C08ABC', joined: true, alreadyMember: false }),
      } as Response)

      const result = await api.joinChannel('C08ABC')
      expect(result.joined).toBe(true)
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:7377/v1/integrations/slack/channels/C08ABC/join',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('surfaces a 403 for private channels', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'channel_is_private', message: 'private' }),
      } as Response)

      await expect(api.joinChannel('C08PRIV')).rejects.toMatchObject({ statusCode: 403 })
    })
  })
})

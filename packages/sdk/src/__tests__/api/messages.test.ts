import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessagesAPI } from '../../api/messages.js'
import type { Envelope } from '@maritaca/core'

// Mock fetch
global.fetch = vi.fn()

describe('Messages API', () => {
  let api: MessagesAPI

  beforeEach(() => {
    api = new MessagesAPI('http://localhost:7377', 'test-key')
    vi.clearAllMocks()
  })

  describe('send', () => {
    it('should send message successfully', async () => {
      const mockResponse = {
        messageId: 'msg-123',
        status: 'accepted',
        channels: ['email'],
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { email: 'test@example.com' },
        channels: ['email'],
        payload: { text: 'Test' },
      }

      const result = await api.send(envelope)
      expect(result.messageId).toBe('msg-123')
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:7377/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        }),
      )
    })

    it('should handle API errors', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Validation error' }),
      } as Response)

      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: {},
        channels: ['email'],
        payload: { text: 'Test' },
      }

      await expect(api.send(envelope)).rejects.toThrow()
    })
  })

  describe('get', () => {
    it('should get message successfully', async () => {
      const mockResponse = {
        id: 'msg-123',
        status: 'delivered',
        envelope: {},
        events: [],
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await api.get('msg-123')
      expect(result.id).toBe('msg-123')
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:7377/v1/messages/msg-123',
        expect.objectContaining({
          method: 'GET',
        }),
      )
    })

    it('should handle 404 errors', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not found' }),
      } as Response)

      await expect(api.get('non-existent')).rejects.toThrow()
    })
  })
})

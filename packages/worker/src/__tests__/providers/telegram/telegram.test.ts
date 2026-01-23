import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Envelope } from '@maritaca/core'

// Mock grammy before importing
const mockSendMessage = vi.fn()
const mockGetMe = vi.fn()

vi.mock('grammy', () => {
  return {
    Bot: vi.fn().mockImplementation(() => ({
      api: {
        sendMessage: mockSendMessage,
        getMe: mockGetMe,
      },
    })),
  }
})

import { TelegramProvider } from '../../../providers/telegram/telegram.js'
import { Bot } from 'grammy'

describe('TelegramProvider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...originalEnv,
      TELEGRAM_BOT_TOKEN: 'test-bot-token-123',
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('should create provider with token from env', () => {
      const provider = new TelegramProvider()
      expect(provider.channel).toBe('telegram')
      expect(Bot).toHaveBeenCalledWith('test-bot-token-123')
    })

    it('should create provider with explicit token', () => {
      const provider = new TelegramProvider({ botToken: 'explicit-token' })
      expect(provider.channel).toBe('telegram')
      expect(Bot).toHaveBeenCalledWith('explicit-token')
    })

    it('should throw if no bot token', () => {
      delete process.env.TELEGRAM_BOT_TOKEN
      expect(() => new TelegramProvider()).toThrow('TELEGRAM_BOT_TOKEN is required')
    })
  })

  describe('validate', () => {
    let provider: TelegramProvider

    beforeEach(() => {
      provider = new TelegramProvider()
    })

    it('should validate envelope with Telegram recipient (numeric chatId)', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { telegram: { chatId: 123456789 } },
        channels: ['telegram'],
        payload: { text: 'Test message' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should validate envelope with Telegram recipient (string chatId)', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { telegram: { chatId: '@channelname' } },
        channels: ['telegram'],
        payload: { text: 'Test message' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should validate envelope with multiple recipients', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: [
          { telegram: { chatId: 123456789 } },
          { telegram: { chatId: '@groupchat' } },
        ],
        channels: ['telegram'],
        payload: { text: 'Broadcast' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should throw if no Telegram recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { email: 'test@example.com' },
        channels: ['telegram'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).toThrow('At least one recipient must have a Telegram chat ID')
    })

    it('should throw if Telegram recipient has empty chatId', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { telegram: { chatId: '' } },
        channels: ['telegram'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).toThrow('At least one recipient must have a Telegram chat ID')
    })
  })

  describe('prepare', () => {
    let provider: TelegramProvider

    beforeEach(() => {
      provider = new TelegramProvider()
    })

    it('should prepare message with numeric chatId', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { telegram: { chatId: 123456789 } },
        channels: ['telegram'],
        payload: { text: 'Test message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('telegram')
      expect(prepared.data.chatIds).toContain(123456789)
      expect(prepared.data.text).toBe('Test message')
      expect(prepared.data.parseMode).toBe('HTML')
      expect(prepared.data.disableNotification).toBe(false)
    })

    it('should prepare message with string chatId', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { telegram: { chatId: '@channelname' } },
        channels: ['telegram'],
        payload: { text: 'Channel message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.chatIds).toContain('@channelname')
    })

    it('should include title in message body with HTML', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { telegram: { chatId: 123 } },
        channels: ['telegram'],
        payload: { title: 'Alert', text: 'Server down!' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.text).toBe('<b>Alert</b>\n\nServer down!')
    })

    it('should use overrides for parseMode', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { telegram: { chatId: 123 } },
        channels: ['telegram'],
        payload: { text: '*Bold text*' },
        overrides: {
          telegram: { parseMode: 'MarkdownV2' },
        },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.parseMode).toBe('MarkdownV2')
    })

    it('should use disableNotification override', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { telegram: { chatId: 123 } },
        channels: ['telegram'],
        payload: { text: 'Silent message' },
        overrides: {
          telegram: { disableNotification: true },
        },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.disableNotification).toBe(true)
    })

    it('should include replyToMessageId', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { telegram: { chatId: 123 } },
        channels: ['telegram'],
        payload: { text: 'Reply' },
        overrides: {
          telegram: { replyToMessageId: 42 },
        },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.replyToMessageId).toBe(42)
    })

    it('should collect multiple chatIds', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: [
          { telegram: { chatId: 111 } },
          { telegram: { chatId: 222 } },
          { email: 'skip@test.com' },
          { telegram: { chatId: '@channel' } },
        ],
        channels: ['telegram'],
        payload: { text: 'Multi' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.chatIds).toHaveLength(3)
      expect(prepared.data.chatIds).toContain(111)
      expect(prepared.data.chatIds).toContain(222)
      expect(prepared.data.chatIds).toContain('@channel')
    })

    it('should throw if no Telegram recipients found', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { email: 'test@example.com' },
        channels: ['telegram'],
        payload: { text: 'Test' },
      }

      expect(() => provider.prepare(envelope)).toThrow('No Telegram recipients found')
    })
  })

  describe('send', () => {
    let provider: TelegramProvider

    beforeEach(() => {
      vi.clearAllMocks()
      provider = new TelegramProvider()
    })

    it('should send message successfully', async () => {
      mockSendMessage.mockResolvedValue({
        message_id: 12345,
        chat: { id: 123456789 },
      })

      const prepared = {
        channel: 'telegram' as const,
        data: {
          chatIds: [123456789],
          text: 'Test message',
          parseMode: 'HTML' as const,
          disableNotification: false,
          replyToMessageId: undefined,
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.externalId).toBe('12345')
      expect(response.data?.sent).toBe(1)
      expect(mockSendMessage).toHaveBeenCalledWith(123456789, 'Test message', {
        parse_mode: 'HTML',
        disable_notification: false,
        reply_parameters: undefined,
      })
    })

    it('should send with replyToMessageId', async () => {
      mockSendMessage.mockResolvedValue({ message_id: 999 })

      const prepared = {
        channel: 'telegram' as const,
        data: {
          chatIds: [123],
          text: 'Reply',
          parseMode: 'HTML' as const,
          disableNotification: false,
          replyToMessageId: 42,
        },
      }

      await provider.send(prepared)
      expect(mockSendMessage).toHaveBeenCalledWith(123, 'Reply', {
        parse_mode: 'HTML',
        disable_notification: false,
        reply_parameters: { message_id: 42 },
      })
    })

    it('should send to multiple recipients', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ message_id: 1 })
        .mockResolvedValueOnce({ message_id: 2 })
        .mockResolvedValueOnce({ message_id: 3 })

      const prepared = {
        channel: 'telegram' as const,
        data: {
          chatIds: [111, 222, '@channel'],
          text: 'Broadcast',
          parseMode: 'HTML' as const,
          disableNotification: true,
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.data?.sent).toBe(3)
      expect(response.data?.messageIds).toHaveLength(3)
      expect(mockSendMessage).toHaveBeenCalledTimes(3)
    })

    it('should handle partial failure', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ message_id: 1 })
        .mockRejectedValueOnce(new Error('Chat not found'))

      const prepared = {
        channel: 'telegram' as const,
        data: {
          chatIds: [111, 999],
          text: 'Test',
          parseMode: 'HTML' as const,
          disableNotification: false,
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.data?.sent).toBe(1)
      expect(response.data?.failed).toBe(1)
    })

    it('should handle complete failure', async () => {
      const error = new Error('Bot blocked by user')
      ;(error as any).error_code = 403
      mockSendMessage.mockRejectedValue(error)

      const prepared = {
        channel: 'telegram' as const,
        data: {
          chatIds: [123],
          text: 'Test',
          parseMode: 'HTML' as const,
          disableNotification: false,
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(false)
      expect(response.error?.code).toBe('TELEGRAM_FORBIDDEN')
      expect(response.error?.message).toBe('Bot blocked by user')
    })

    it('should return TELEGRAM_BAD_REQUEST for 400 errors', async () => {
      const error = new Error('Invalid chat_id')
      ;(error as any).error_code = 400
      mockSendMessage.mockRejectedValue(error)

      const prepared = {
        channel: 'telegram' as const,
        data: {
          chatIds: ['invalid'],
          text: 'Test',
          parseMode: 'HTML' as const,
          disableNotification: false,
        },
      }

      const response = await provider.send(prepared)
      expect(response.error?.code).toBe('TELEGRAM_BAD_REQUEST')
    })
  })

  describe('healthCheck', () => {
    let provider: TelegramProvider

    beforeEach(() => {
      vi.clearAllMocks()
      provider = new TelegramProvider()
    })

    it('should return ok when Telegram is accessible', async () => {
      mockGetMe.mockResolvedValue({
        id: 123456789,
        is_bot: true,
        first_name: 'TestBot',
        username: 'test_bot',
        can_join_groups: true,
        can_read_all_group_messages: false,
      })

      const result = await provider.healthCheck()

      expect(result.ok).toBe(true)
      expect(result.details?.botId).toBe(123456789)
      expect(result.details?.botUsername).toBe('test_bot')
    })

    it('should return error when Telegram is not accessible', async () => {
      mockGetMe.mockRejectedValue(new Error('Unauthorized'))

      const result = await provider.healthCheck()

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Unauthorized')
    })
  })

  describe('mapEvents', () => {
    let provider: TelegramProvider

    beforeEach(() => {
      provider = new TelegramProvider()
    })

    it('should map successful response to succeeded event', () => {
      const response = {
        success: true,
        data: { sent: 1, messageIds: [12345] },
        externalId: '12345',
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.succeeded')
      expect(events[0].channel).toBe('telegram')
      expect(events[0].provider).toBe('telegram')
      expect(events[0].messageId).toBe('msg-123')
      expect(events[0].payload).toEqual(response.data)
    })

    it('should map failed response to failed event', () => {
      const response = {
        success: false,
        error: {
          code: 'TELEGRAM_FORBIDDEN',
          message: 'Bot blocked',
        },
      }

      const events = provider.mapEvents(response, 'msg-456')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.failed')
      expect(events[0].channel).toBe('telegram')
      expect(events[0].provider).toBe('telegram')
      expect(events[0].payload.error).toEqual(response.error)
    })
  })
})

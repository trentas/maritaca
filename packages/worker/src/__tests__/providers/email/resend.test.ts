import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Envelope } from '@maritaca/core'

// Mock the resend module before importing ResendProvider
vi.mock('resend', () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: {
        send: vi.fn(),
      },
    })),
  }
})

import { ResendProvider } from '../../../providers/email/resend.js'
import { Resend } from 'resend'

describe('ResendProvider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, RESEND_API_KEY: 'test-api-key' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('should create provider with API key from env', () => {
      const provider = new ResendProvider()
      expect(provider.channel).toBe('email')
      expect(Resend).toHaveBeenCalledWith('test-api-key')
    })

    it('should create provider with API key from options', () => {
      const provider = new ResendProvider({ apiKey: 'custom-api-key' })
      expect(Resend).toHaveBeenCalledWith('custom-api-key')
    })

    it('should throw if no API key is provided', () => {
      delete process.env.RESEND_API_KEY
      expect(() => new ResendProvider()).toThrow('RESEND_API_KEY is required')
    })
  })

  describe('validate', () => {
    let provider: ResendProvider

    beforeEach(() => {
      provider = new ResendProvider()
    })

    it('should validate envelope with email recipient and sender', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { email: 'sender@example.com' },
        recipient: { email: 'recipient@example.com' },
        channels: ['email'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should throw if no email recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { email: 'sender@example.com' },
        recipient: { slack: { userId: 'U123' } },
        channels: ['email'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).toThrow('At least one recipient must have an email address')
    })

    it('should throw if no sender email', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Sender' },
        recipient: { email: 'recipient@example.com' },
        channels: ['email'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).toThrow('Sender email is required')
    })
  })

  describe('prepare', () => {
    let provider: ResendProvider

    beforeEach(() => {
      provider = new ResendProvider()
    })

    it('should prepare message for Resend', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { email: 'sender@example.com' },
        recipient: { email: 'recipient@example.com' },
        channels: ['email'],
        payload: { text: 'Test message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('email')
      expect(prepared.data.to).toContain('recipient@example.com')
      expect(prepared.data.from).toBe('sender@example.com')
      expect(prepared.data.text).toBe('Test message')
    })

    it('should include sender name in from address', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test Sender', email: 'sender@example.com' },
        recipient: { email: 'recipient@example.com' },
        channels: ['email'],
        payload: { text: 'Test' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.from).toBe('Test Sender <sender@example.com>')
    })

    it('should use override subject if provided', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { email: 'sender@example.com' },
        recipient: { email: 'recipient@example.com' },
        channels: ['email'],
        payload: { title: 'Title', text: 'Body' },
        overrides: {
          email: { subject: 'Custom Subject' },
        },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.subject).toBe('Custom Subject')
    })
  })

  describe('send', () => {
    let provider: ResendProvider
    let mockSend: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockSend = vi.fn()
      vi.mocked(Resend).mockImplementation(() => ({
        emails: { send: mockSend },
      }) as any)
      provider = new ResendProvider()
    })

    it('should send email successfully', async () => {
      mockSend.mockResolvedValue({
        data: { id: 'resend-msg-123' },
        error: null,
      })

      const prepared = {
        channel: 'email' as const,
        data: {
          to: ['recipient@example.com'],
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Test message',
          html: '<p>Test message</p>',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.externalId).toBe('resend-msg-123')
      expect(mockSend).toHaveBeenCalledWith({
        from: 'sender@example.com',
        to: ['recipient@example.com'],
        subject: 'Test',
        text: 'Test message',
        html: '<p>Test message</p>',
      })
    })

    it('should handle Resend API error', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: {
          name: 'validation_error',
          message: 'Invalid email address',
        },
      })

      const prepared = {
        channel: 'email' as const,
        data: {
          to: ['invalid-email'],
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Test message',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(false)
      expect(response.error?.code).toBe('validation_error')
      expect(response.error?.message).toBe('Invalid email address')
    })

    it('should handle network exception', async () => {
      mockSend.mockRejectedValue(new Error('Network error'))

      const prepared = {
        channel: 'email' as const,
        data: {
          to: ['recipient@example.com'],
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Test message',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(false)
      expect(response.error?.code).toBe('RESEND_EXCEPTION')
      expect(response.error?.message).toBe('Network error')
    })
  })

  describe('mapEvents', () => {
    let provider: ResendProvider

    beforeEach(() => {
      provider = new ResendProvider()
    })

    it('should map successful response to succeeded event', () => {
      const response = {
        success: true,
        data: { sent: true },
        externalId: 'resend-123',
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.succeeded')
      expect(events[0].messageId).toBe('msg-123')
      expect(events[0].channel).toBe('email')
      expect(events[0].provider).toBe('resend')
    })

    it('should map failed response to failed event', () => {
      const response = {
        success: false,
        error: {
          code: 'RESEND_ERROR',
          message: 'Failed to send',
        },
      }

      const events = provider.mapEvents(response, 'msg-456')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.failed')
      expect(events[0].messageId).toBe('msg-456')
      expect(events[0].provider).toBe('resend')
    })
  })
})

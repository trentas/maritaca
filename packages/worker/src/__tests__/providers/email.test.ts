import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmailProvider } from '../../providers/email.js'
import type { Envelope } from '@maritaca/core'

describe('Email Provider', () => {
  let provider: EmailProvider

  beforeEach(() => {
    provider = new EmailProvider()
    vi.clearAllMocks()
  })

  describe('validate', () => {
    it('should validate envelope with email recipient', () => {
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
        sender: {},
        recipient: { slack: { userId: 'U123' } },
        channels: ['email'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).toThrow()
    })
  })

  describe('prepare', () => {
    it('should prepare message for email', () => {
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
      expect(prepared.data.text).toBe('Test message')
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
    it('should send email (mock)', async () => {
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
      expect(response.success).toBe(true)
      expect(response.data?.to).toContain('recipient@example.com')
    })
  })

  describe('mapEvents', () => {
    it('should map successful response to events', () => {
      const response = {
        success: true,
        data: { sent: true },
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.succeeded')
    })
  })
})

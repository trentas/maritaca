import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EmailProvider } from '../../providers/email.js'
import type { Envelope } from '@maritaca/core'

describe('Email Provider', () => {
  let provider: EmailProvider

  beforeEach(() => {
    provider = new EmailProvider()
    vi.clearAllMocks()
  })

  afterEach(() => {
    provider.clearSimulation()
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
    it('should send email successfully (mock)', async () => {
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

    it('should fail when forceError simulation is set', async () => {
      provider.setSimulation({
        forceError: {
          code: 'SMTP_CONNECTION_FAILED',
          message: 'Could not connect to SMTP server',
        },
      })

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
      expect(response.error?.code).toBe('SMTP_CONNECTION_FAILED')
      expect(response.error?.message).toBe('Could not connect to SMTP server')
    })

    it('should fail for specific recipients when recipientErrors is set', async () => {
      provider.setSimulation({
        recipientErrors: {
          'invalid@example.com': 'Mailbox not found',
        },
      })

      const prepared = {
        channel: 'email' as const,
        data: {
          to: ['invalid@example.com'],
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Test message',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(false)
      expect(response.error?.code).toBe('RECIPIENT_DELIVERY_FAILED')
      expect(response.error?.message).toBe('Mailbox not found')
    })

    it('should partially succeed when some recipients fail', async () => {
      provider.setSimulation({
        recipientErrors: {
          'invalid@example.com': 'Mailbox not found',
        },
      })

      const prepared = {
        channel: 'email' as const,
        data: {
          to: ['valid@example.com', 'invalid@example.com'],
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Test message',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.data?.partialFailure).toBe(true)
      expect(response.data?.to).toContain('valid@example.com')
      expect(response.data?.to).not.toContain('invalid@example.com')
      expect(response.data?.failedRecipients).toContain('invalid@example.com')
    })

    it('should fail randomly when failureRate is set to 1', async () => {
      provider.setSimulation({
        failureRate: 1, // 100% failure rate
      })

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
      expect(response.error?.code).toBe('SIMULATED_RANDOM_FAILURE')
    })

    it('should succeed when failureRate is 0', async () => {
      provider.setSimulation({
        failureRate: 0, // 0% failure rate
      })

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
    })

    it('should respect network delay simulation', async () => {
      const delayMs = 50
      provider.setSimulation({ delayMs })

      const prepared = {
        channel: 'email' as const,
        data: {
          to: ['recipient@example.com'],
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Test message',
        },
      }

      const start = Date.now()
      await provider.send(prepared)
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(delayMs - 10) // Allow small timing variance
    })
  })

  describe('mapEvents', () => {
    it('should map successful response to succeeded event', () => {
      const response = {
        success: true,
        data: { sent: true },
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.succeeded')
      expect(events[0].messageId).toBe('msg-123')
      expect(events[0].channel).toBe('email')
    })

    it('should map failed response to failed event', () => {
      const response = {
        success: false,
        error: {
          code: 'SMTP_ERROR',
          message: 'Connection refused',
        },
      }

      const events = provider.mapEvents(response, 'msg-456')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.failed')
      expect(events[0].messageId).toBe('msg-456')
      expect(events[0].payload?.error).toEqual(response.error)
    })
  })
})

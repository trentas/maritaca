import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Envelope } from '@maritaca/core'

const mockSend = vi.fn()
const mockPing = vi.fn()

vi.mock('@mailchimp/mailchimp_transactional', () => {
  return {
    default: vi.fn(() => ({
      messages: { send: mockSend },
      users: { ping: mockPing },
    })),
  }
})

import { MandrillProvider } from '../../../providers/email/mandrill.js'

describe('MandrillProvider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, MANDRILL_API_KEY: 'md-test' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('throws when API key is missing', () => {
      delete process.env.MANDRILL_API_KEY
      expect(() => new MandrillProvider()).toThrow('MANDRILL_API_KEY is required')
    })

    it('uses options.apiKey when provided', () => {
      expect(() => new MandrillProvider({ apiKey: 'md-explicit' })).not.toThrow()
    })
  })

  describe('validate', () => {
    it('accepts an envelope with email recipient + sender email', () => {
      const provider = new MandrillProvider()
      const envelope: Envelope = {
        idempotencyKey: 'k',
        sender: { email: 'sender@example.com' },
        recipient: { email: 'rcpt@example.com' },
        channels: ['email'],
        payload: { text: 'hi' },
      }
      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('rejects envelope without sender email', () => {
      const provider = new MandrillProvider()
      const envelope: Envelope = {
        idempotencyKey: 'k',
        sender: {},
        recipient: { email: 'rcpt@example.com' },
        channels: ['email'],
        payload: { text: 'hi' },
      }
      expect(() => provider.validate(envelope)).toThrow('Sender email is required')
    })
  })

  describe('prepare', () => {
    it('builds the Mandrill payload from the envelope', () => {
      const provider = new MandrillProvider()
      const envelope: Envelope = {
        idempotencyKey: 'k',
        sender: { name: 'Sender', email: 'sender@example.com' },
        recipient: { email: 'rcpt@example.com' },
        channels: ['email'],
        payload: { title: 'Hi', text: 'body', html: '<p>body</p>' },
        overrides: { email: { replyTo: 'reply@example.com' } },
      }
      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('email')
      expect(prepared.data).toMatchObject({
        to: ['rcpt@example.com'],
        fromEmail: 'sender@example.com',
        fromName: 'Sender',
        replyTo: 'reply@example.com',
        subject: 'Hi',
        text: 'body',
        html: '<p>body</p>',
      })
    })

    it('uses envelope.overrides.email.subject when present', () => {
      const provider = new MandrillProvider()
      const envelope: Envelope = {
        idempotencyKey: 'k',
        sender: { email: 'sender@example.com' },
        recipient: { email: 'rcpt@example.com' },
        channels: ['email'],
        payload: { title: 'Title', text: 'body' },
        overrides: { email: { subject: 'Custom Subject' } },
      }
      expect(provider.prepare(envelope).data.subject).toBe('Custom Subject')
    })
  })

  describe('send', () => {
    const prepared = {
      channel: 'email' as const,
      data: {
        to: ['rcpt@example.com'],
        fromEmail: 'sender@example.com',
        fromName: 'Sender',
        replyTo: 'reply@example.com',
        subject: 'Hi',
        text: 'body',
        html: '<p>body</p>',
      },
    }

    it('returns success and externalId from the first accepted result', async () => {
      mockSend.mockResolvedValue([
        { email: 'rcpt@example.com', status: 'sent', _id: 'mc-1' },
      ])
      const provider = new MandrillProvider()
      const res = await provider.send(prepared)
      expect(res.success).toBe(true)
      expect(res.externalId).toBe('mc-1')
      expect(mockSend).toHaveBeenCalledWith({
        message: {
          from_email: 'sender@example.com',
          from_name: 'Sender',
          to: [{ email: 'rcpt@example.com', type: 'to' }],
          subject: 'Hi',
          text: 'body',
          html: '<p>body</p>',
          headers: { 'Reply-To': 'reply@example.com' },
        },
      })
    })

    it('treats all-rejected response as failure with the reject_reason as code', async () => {
      mockSend.mockResolvedValue([
        { email: 'rcpt@example.com', status: 'rejected', reject_reason: 'hard-bounce' },
      ])
      const provider = new MandrillProvider()
      const res = await provider.send(prepared)
      expect(res.success).toBe(false)
      expect(res.error?.code).toBe('hard-bounce')
    })

    it('treats partial reject as success but flags partialFailure', async () => {
      mockSend.mockResolvedValue([
        { email: 'a@example.com', status: 'sent', _id: 'mc-1' },
        { email: 'b@example.com', status: 'rejected', reject_reason: 'soft-bounce' },
      ])
      const provider = new MandrillProvider()
      const res = await provider.send({ ...prepared, data: { ...prepared.data, to: ['a@example.com', 'b@example.com'] } })
      expect(res.success).toBe(true)
      expect(res.data?.partialFailure).toBe(true)
    })

    it('maps API error response to a failure', async () => {
      mockSend.mockResolvedValue({ status: 'error', name: 'Invalid_Key', message: 'Invalid API key' })
      const provider = new MandrillProvider()
      const res = await provider.send(prepared)
      expect(res.success).toBe(false)
      expect(res.error?.code).toBe('Invalid_Key')
      expect(res.error?.message).toBe('Invalid API key')
    })

    it('catches network exceptions', async () => {
      mockSend.mockRejectedValue(new Error('boom'))
      const provider = new MandrillProvider()
      const res = await provider.send(prepared)
      expect(res.success).toBe(false)
      expect(res.error?.code).toBe('MANDRILL_EXCEPTION')
      expect(res.error?.message).toBe('boom')
    })
  })

  describe('mapEvents', () => {
    it('emits attempt.succeeded with provider=mandrill on success', () => {
      const provider = new MandrillProvider()
      const events = provider.mapEvents({ success: true, externalId: 'mc-1', data: {} }, 'msg-1')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.succeeded')
      expect(events[0].provider).toBe('mandrill')
    })

    it('emits attempt.failed on failure', () => {
      const provider = new MandrillProvider()
      const events = provider.mapEvents({ success: false, error: { code: 'x', message: 'y' } }, 'msg-1')
      expect(events[0].type).toBe('attempt.failed')
      expect(events[0].provider).toBe('mandrill')
    })
  })
})

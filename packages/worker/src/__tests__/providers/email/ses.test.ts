import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Envelope } from '@maritaca/core'

// Mock the AWS SES client before importing SESProvider
vi.mock('@aws-sdk/client-ses', () => {
  const SESClient = vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  }))
  const SendEmailCommand = vi.fn().mockImplementation((input) => ({ input }))
  const GetAccountCommand = vi.fn().mockImplementation((input) => ({ input }))
  
  return {
    SESClient,
    SendEmailCommand,
    GetAccountCommand,
    // Provider imports as default: import sesSdk from '@aws-sdk/client-ses'
    default: { SESClient, SendEmailCommand, GetAccountCommand },
  }
})

import { SESProvider } from '../../../providers/email/ses.js'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

describe('SESProvider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...originalEnv,
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('should create provider with credentials from env', () => {
      const provider = new SESProvider()
      expect(provider.channel).toBe('email')
      expect(SESClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      })
    })

    it('should create provider with credentials from options', () => {
      const provider = new SESProvider({
        region: 'eu-west-1',
        accessKeyId: 'custom-key',
        secretAccessKey: 'custom-secret',
      })
      expect(SESClient).toHaveBeenCalledWith({
        region: 'eu-west-1',
        credentials: {
          accessKeyId: 'custom-key',
          secretAccessKey: 'custom-secret',
        },
      })
    })

    it('should create provider without explicit credentials (for IAM role)', () => {
      delete process.env.AWS_ACCESS_KEY_ID
      delete process.env.AWS_SECRET_ACCESS_KEY
      
      const provider = new SESProvider()
      expect(SESClient).toHaveBeenCalledWith({
        region: 'us-east-1',
      })
    })

    it('should throw if no region is provided', () => {
      delete process.env.AWS_REGION
      delete process.env.AWS_DEFAULT_REGION
      expect(() => new SESProvider()).toThrow('AWS_REGION is required')
    })

    it('should use AWS_DEFAULT_REGION as fallback', () => {
      delete process.env.AWS_REGION
      process.env.AWS_DEFAULT_REGION = 'ap-southeast-1'
      
      const provider = new SESProvider()
      expect(SESClient).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'ap-southeast-1',
        })
      )
    })
  })

  describe('validate', () => {
    let provider: SESProvider

    beforeEach(() => {
      provider = new SESProvider()
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
    let provider: SESProvider

    beforeEach(() => {
      provider = new SESProvider()
    })

    it('should prepare message for SES', () => {
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
    let provider: SESProvider
    let mockSend: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockSend = vi.fn()
      vi.mocked(SESClient).mockImplementation(() => ({
        send: mockSend,
      }) as any)
      provider = new SESProvider()
    })

    it('should send email successfully', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-msg-123',
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
      expect(response.externalId).toBe('ses-msg-123')
      expect(mockSend).toHaveBeenCalled()
      
      // Verify SendEmailCommand was created with correct parameters
      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'sender@example.com',
        Destination: {
          ToAddresses: ['recipient@example.com'],
        },
        Message: {
          Subject: {
            Data: 'Test',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: 'Test message',
              Charset: 'UTF-8',
            },
            Html: {
              Data: '<p>Test message</p>',
              Charset: 'UTF-8',
            },
          },
        },
      })
    })

    it('should send email with text only', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-msg-456',
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
      
      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'sender@example.com',
        Destination: {
          ToAddresses: ['recipient@example.com'],
        },
        Message: {
          Subject: {
            Data: 'Test',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: 'Test message',
              Charset: 'UTF-8',
            },
          },
        },
      })
    })

    it('should handle SES error', async () => {
      const error = new Error('Email address not verified')
      error.name = 'MessageRejected'
      mockSend.mockRejectedValue(error)

      const prepared = {
        channel: 'email' as const,
        data: {
          to: ['recipient@example.com'],
          from: 'unverified@example.com',
          subject: 'Test',
          text: 'Test message',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(false)
      expect(response.error?.code).toBe('MessageRejected')
      expect(response.error?.message).toBe('Email address not verified')
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
      expect(response.error?.code).toBe('Error')
      expect(response.error?.message).toBe('Network error')
    })
  })

  describe('mapEvents', () => {
    let provider: SESProvider

    beforeEach(() => {
      provider = new SESProvider()
    })

    it('should map successful response to succeeded event', () => {
      const response = {
        success: true,
        data: { sent: true },
        externalId: 'ses-123',
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.succeeded')
      expect(events[0].messageId).toBe('msg-123')
      expect(events[0].channel).toBe('email')
      expect(events[0].provider).toBe('ses')
    })

    it('should map failed response to failed event', () => {
      const response = {
        success: false,
        error: {
          code: 'SES_ERROR',
          message: 'Failed to send',
        },
      }

      const events = provider.mapEvents(response, 'msg-456')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.failed')
      expect(events[0].messageId).toBe('msg-456')
      expect(events[0].provider).toBe('ses')
    })
  })

  describe('healthCheck', () => {
    it('should have healthCheck method', () => {
      const provider = new SESProvider()
      expect(typeof provider.healthCheck).toBe('function')
    })
  })
})

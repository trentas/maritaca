import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Envelope } from '@maritaca/core'

// Mock the AWS SNS client before importing
vi.mock('@aws-sdk/client-sns', () => {
  return {
    SNSClient: vi.fn().mockImplementation(() => ({
      send: vi.fn(),
    })),
    PublishCommand: vi.fn().mockImplementation((input) => ({ input })),
    GetSMSAttributesCommand: vi.fn().mockImplementation((input) => ({ input })),
  }
})

import { SnsSmsProvider } from '../../../providers/sms/sns.js'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'

describe('SnsSmsProvider', () => {
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
      const provider = new SnsSmsProvider()
      expect(provider.channel).toBe('sms')
      expect(SNSClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      })
    })

    it('should create provider with credentials from options', () => {
      const provider = new SnsSmsProvider({
        region: 'eu-west-1',
        accessKeyId: 'custom-key',
        secretAccessKey: 'custom-secret',
      })
      expect(SNSClient).toHaveBeenCalledWith({
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
      
      const provider = new SnsSmsProvider()
      expect(SNSClient).toHaveBeenCalledWith({
        region: 'us-east-1',
      })
    })

    it('should throw if no region is provided', () => {
      delete process.env.AWS_REGION
      delete process.env.AWS_DEFAULT_REGION
      expect(() => new SnsSmsProvider()).toThrow('AWS_REGION is required')
    })

    it('should use AWS_DEFAULT_REGION as fallback', () => {
      delete process.env.AWS_REGION
      process.env.AWS_DEFAULT_REGION = 'ap-southeast-1'
      
      const provider = new SnsSmsProvider()
      expect(SNSClient).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'ap-southeast-1',
        })
      )
    })
  })

  describe('validate', () => {
    let provider: SnsSmsProvider

    beforeEach(() => {
      provider = new SnsSmsProvider()
    })

    it('should validate envelope with SMS recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { sms: { phoneNumber: '+5511999999999' } },
        channels: ['sms'],
        payload: { text: 'Test message' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should throw if no SMS recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { email: 'test@example.com' },
        channels: ['sms'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).toThrow('At least one recipient must have an SMS phone number')
    })

    it('should validate with multiple recipients', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: [
          { email: 'test@example.com' },
          { sms: { phoneNumber: '+5511999999999' } },
        ],
        channels: ['sms'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })
  })

  describe('prepare', () => {
    let provider: SnsSmsProvider

    beforeEach(() => {
      provider = new SnsSmsProvider()
    })

    it('should prepare message for SNS', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { sms: { phoneNumber: '+5511999999999' } },
        channels: ['sms'],
        payload: { text: 'Test message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('sms')
      expect(prepared.data.phoneNumbers).toContain('+5511999999999')
      expect(prepared.data.message).toBe('Test message')
      expect(prepared.data.messageType).toBe('Transactional')
    })

    it('should include title in message', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { sms: { phoneNumber: '+5511999999999' } },
        channels: ['sms'],
        payload: { title: 'Alert', text: 'Server is down' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.message).toBe('Alert: Server is down')
    })

    it('should use override messageType', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { sms: { phoneNumber: '+5511999999999' } },
        channels: ['sms'],
        payload: { text: 'Promo!' },
        overrides: {
          sms: { messageType: 'Promotional' },
        },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.messageType).toBe('Promotional')
    })

    it('should include senderId from overrides', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { sms: { phoneNumber: '+5511999999999' } },
        channels: ['sms'],
        payload: { text: 'Test' },
        overrides: {
          sms: { senderId: 'ACME' },
        },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.senderId).toBe('ACME')
    })

    it('should throw if no SMS recipients after filtering', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { email: 'test@example.com' },
        channels: ['sms'],
        payload: { text: 'Test' },
      }

      expect(() => provider.prepare(envelope)).toThrow('No SMS recipients found')
    })
  })

  describe('send', () => {
    let provider: SnsSmsProvider
    let mockSend: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockSend = vi.fn()
      vi.mocked(SNSClient).mockImplementation(() => ({
        send: mockSend,
      }) as any)
      provider = new SnsSmsProvider()
    })

    it('should send SMS successfully', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'sns-msg-123',
      })

      const prepared = {
        channel: 'sms' as const,
        data: {
          phoneNumbers: ['+5511999999999'],
          message: 'Test message',
          messageType: 'Transactional',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.externalId).toBe('sns-msg-123')
      expect(response.data?.sent).toBe(1)
      expect(response.data?.failed).toBe(0)
    })

    it('should send to multiple recipients', async () => {
      mockSend
        .mockResolvedValueOnce({ MessageId: 'msg-1' })
        .mockResolvedValueOnce({ MessageId: 'msg-2' })

      const prepared = {
        channel: 'sms' as const,
        data: {
          phoneNumbers: ['+5511999999999', '+5511888888888'],
          message: 'Test',
          messageType: 'Transactional',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.data?.sent).toBe(2)
      expect(response.data?.messageIds).toHaveLength(2)
    })

    it('should handle partial failure', async () => {
      mockSend
        .mockResolvedValueOnce({ MessageId: 'msg-1' })
        .mockRejectedValueOnce(new Error('Invalid phone'))

      const prepared = {
        channel: 'sms' as const,
        data: {
          phoneNumbers: ['+5511999999999', 'invalid'],
          message: 'Test',
          messageType: 'Transactional',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.data?.sent).toBe(1)
      expect(response.data?.failed).toBe(1)
    })

    it('should handle all failures', async () => {
      mockSend.mockRejectedValue(new Error('SNS error'))

      const prepared = {
        channel: 'sms' as const,
        data: {
          phoneNumbers: ['+5511999999999'],
          message: 'Test',
          messageType: 'Transactional',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(false)
      expect(response.error?.code).toBe('SNS_SMS_ERROR')
    })

    it('should include senderId in message attributes', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-123' })

      const prepared = {
        channel: 'sms' as const,
        data: {
          phoneNumbers: ['+5511999999999'],
          message: 'Test',
          messageType: 'Transactional',
          senderId: 'ACME',
        },
      }

      await provider.send(prepared)

      expect(PublishCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          PhoneNumber: '+5511999999999',
          Message: 'Test',
          MessageAttributes: expect.objectContaining({
            'AWS.SNS.SMS.SenderID': {
              DataType: 'String',
              StringValue: 'ACME',
            },
          }),
        })
      )
    })
  })

  describe('mapEvents', () => {
    let provider: SnsSmsProvider

    beforeEach(() => {
      provider = new SnsSmsProvider()
    })

    it('should map successful response to succeeded event', () => {
      const response = {
        success: true,
        data: { sent: 1, failed: 0 },
        externalId: 'sns-123',
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.succeeded')
      expect(events[0].messageId).toBe('msg-123')
      expect(events[0].channel).toBe('sms')
      expect(events[0].provider).toBe('sns-sms')
    })

    it('should map failed response to failed event', () => {
      const response = {
        success: false,
        error: {
          code: 'SNS_SMS_ERROR',
          message: 'Failed to send',
        },
      }

      const events = provider.mapEvents(response, 'msg-456')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.failed')
      expect(events[0].messageId).toBe('msg-456')
    })
  })

  describe('healthCheck', () => {
    let provider: SnsSmsProvider
    let mockSend: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockSend = vi.fn()
      vi.mocked(SNSClient).mockImplementation(() => ({
        send: mockSend,
      }) as any)
      provider = new SnsSmsProvider()
    })

    it('should return ok when SNS is accessible', async () => {
      mockSend.mockResolvedValue({
        attributes: { DefaultSMSType: 'Transactional' },
      })

      const result = await provider.healthCheck()
      expect(result.ok).toBe(true)
      expect(result.details?.region).toBe('us-east-1')
    })

    it('should return error when SNS is not accessible', async () => {
      mockSend.mockRejectedValue(new Error('Access denied'))

      const result = await provider.healthCheck()
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Access denied')
    })
  })
})

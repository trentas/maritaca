import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Envelope } from '@maritaca/core'

// Mock the AWS SNS client before importing
vi.mock('@aws-sdk/client-sns', () => {
  const SNSClient = vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  }))
  const PublishCommand = vi.fn().mockImplementation((input) => ({ input }))
  const CreatePlatformEndpointCommand = vi.fn().mockImplementation((input) => ({ input }))
  const ListPlatformApplicationsCommand = vi.fn().mockImplementation((input) => ({ input }))
  
  return {
    SNSClient,
    PublishCommand,
    CreatePlatformEndpointCommand,
    ListPlatformApplicationsCommand,
    // Provider imports as default: import snsSdk from '@aws-sdk/client-sns'
    default: { SNSClient, PublishCommand, CreatePlatformEndpointCommand, ListPlatformApplicationsCommand },
  }
})

import { SnsPushProvider } from '../../../providers/push/sns.js'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'

describe('SnsPushProvider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...originalEnv,
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      SNS_APNS_PLATFORM_ARN: 'arn:aws:sns:us-east-1:123:app/APNS/MyApp',
      SNS_GCM_PLATFORM_ARN: 'arn:aws:sns:us-east-1:123:app/GCM/MyApp',
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('should create provider with credentials from env', () => {
      const provider = new SnsPushProvider()
      expect(provider.channel).toBe('push')
      expect(SNSClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      })
    })

    it('should throw if no region is provided', () => {
      delete process.env.AWS_REGION
      delete process.env.AWS_DEFAULT_REGION
      expect(() => new SnsPushProvider()).toThrow('AWS_REGION is required')
    })
  })

  describe('validate', () => {
    let provider: SnsPushProvider

    beforeEach(() => {
      provider = new SnsPushProvider()
    })

    it('should validate envelope with endpointArn', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { push: { endpointArn: 'arn:aws:sns:...' } },
        channels: ['push'],
        payload: { text: 'Test message' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should validate envelope with deviceToken and platform', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { push: { deviceToken: 'abc123', platform: 'APNS' } },
        channels: ['push'],
        payload: { text: 'Test message' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should throw if no push recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { email: 'test@example.com' },
        channels: ['push'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).toThrow('At least one recipient must have push notification info')
    })
  })

  describe('prepare', () => {
    let provider: SnsPushProvider

    beforeEach(() => {
      provider = new SnsPushProvider()
    })

    it('should prepare message for push', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { push: { endpointArn: 'arn:aws:sns:...' } },
        channels: ['push'],
        payload: { title: 'Alert', text: 'Test message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('push')
      expect(prepared.data.recipients).toHaveLength(1)
      expect(prepared.data.title).toBe('Alert')
      expect(prepared.data.body).toBe('Test message')
    })

    it('should include push overrides', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { push: { endpointArn: 'arn:...' } },
        channels: ['push'],
        payload: { text: 'Test' },
        overrides: {
          push: { badge: 5, sound: 'alert.wav', ttl: 3600 },
        },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.badge).toBe(5)
      expect(prepared.data.sound).toBe('alert.wav')
      expect(prepared.data.ttl).toBe(3600)
    })

    it('should throw if no push recipients after filtering', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { email: 'test@example.com' },
        channels: ['push'],
        payload: { text: 'Test' },
      }

      expect(() => provider.prepare(envelope)).toThrow('No push notification recipients found')
    })
  })

  describe('send', () => {
    let provider: SnsPushProvider
    let mockSend: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockSend = vi.fn()
      vi.mocked(SNSClient).mockImplementation(() => ({
        send: mockSend,
      }) as any)
      provider = new SnsPushProvider()
    })

    it('should send push notification successfully', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'push-msg-123',
      })

      const prepared = {
        channel: 'push' as const,
        data: {
          recipients: [{ endpointArn: 'arn:aws:sns:...' }],
          title: 'Test',
          body: 'Test message',
          sound: 'default',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.externalId).toBe('push-msg-123')
    })

    it('should send to multiple recipients', async () => {
      mockSend
        .mockResolvedValueOnce({ MessageId: 'msg-1' })
        .mockResolvedValueOnce({ MessageId: 'msg-2' })

      const prepared = {
        channel: 'push' as const,
        data: {
          recipients: [
            { endpointArn: 'arn:1' },
            { endpointArn: 'arn:2' },
          ],
          body: 'Test',
          sound: 'default',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.data?.sent).toBe(2)
    })

    it('should handle all failures', async () => {
      mockSend.mockRejectedValue(new Error('Endpoint disabled'))

      const prepared = {
        channel: 'push' as const,
        data: {
          recipients: [{ endpointArn: 'arn:invalid' }],
          body: 'Test',
          sound: 'default',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(false)
      expect(response.error?.code).toBe('SNS_PUSH_ERROR')
    })

    it('should create endpoint for deviceToken', async () => {
      mockSend
        .mockResolvedValueOnce({ EndpointArn: 'arn:created' })
        .mockResolvedValueOnce({ MessageId: 'msg-123' })

      const prepared = {
        channel: 'push' as const,
        data: {
          recipients: [{ deviceToken: 'abc123', platform: 'APNS' }],
          body: 'Test',
          sound: 'default',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
    })
  })

  describe('mapEvents', () => {
    let provider: SnsPushProvider

    beforeEach(() => {
      provider = new SnsPushProvider()
    })

    it('should map successful response to succeeded event', () => {
      const response = {
        success: true,
        data: { sent: 1 },
        externalId: 'push-123',
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.succeeded')
      expect(events[0].channel).toBe('push')
      expect(events[0].provider).toBe('sns-push')
    })

    it('should map failed response to failed event', () => {
      const response = {
        success: false,
        error: { code: 'ERROR', message: 'Failed' },
      }

      const events = provider.mapEvents(response, 'msg-456')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.failed')
    })
  })

  describe('healthCheck', () => {
    let provider: SnsPushProvider
    let mockSend: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockSend = vi.fn()
      vi.mocked(SNSClient).mockImplementation(() => ({
        send: mockSend,
      }) as any)
      provider = new SnsPushProvider()
    })

    it('should return ok when SNS is accessible', async () => {
      mockSend.mockResolvedValue({
        PlatformApplications: [{ PlatformApplicationArn: 'arn:...' }],
      })

      const result = await provider.healthCheck()
      expect(result.ok).toBe(true)
    })

    it('should return error when SNS is not accessible', async () => {
      mockSend.mockRejectedValue(new Error('Access denied'))

      const result = await provider.healthCheck()
      expect(result.ok).toBe(false)
    })
  })
})

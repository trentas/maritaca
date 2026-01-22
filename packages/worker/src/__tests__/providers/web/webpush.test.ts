import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Envelope } from '@maritaca/core'

// Mock web-push before importing
vi.mock('web-push', () => {
  return {
    default: {
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn(),
      generateVAPIDKeys: vi.fn().mockReturnValue({
        publicKey: 'test-public-key',
        privateKey: 'test-private-key',
      }),
    },
  }
})

import { WebPushProvider } from '../../../providers/web/webpush.js'
import webpush from 'web-push'

describe('WebPushProvider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...originalEnv,
      VAPID_PUBLIC_KEY: 'BEl62iUYgUivxWBud2Nt...',
      VAPID_PRIVATE_KEY: 'UUxI4O8k2r...',
      VAPID_SUBJECT: 'mailto:admin@example.com',
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('should create provider with VAPID credentials from env', () => {
      const provider = new WebPushProvider()
      expect(provider.channel).toBe('web')
      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:admin@example.com',
        'BEl62iUYgUivxWBud2Nt...',
        'UUxI4O8k2r...'
      )
    })

    it('should create provider with credentials from options', () => {
      const provider = new WebPushProvider({
        vapidPublicKey: 'custom-public',
        vapidPrivateKey: 'custom-private',
        vapidSubject: 'https://example.com',
      })
      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        'https://example.com',
        'custom-public',
        'custom-private'
      )
    })

    it('should not call setVapidDetails if credentials missing', () => {
      delete process.env.VAPID_PUBLIC_KEY
      delete process.env.VAPID_PRIVATE_KEY
      delete process.env.VAPID_SUBJECT
      
      vi.clearAllMocks()
      const provider = new WebPushProvider()
      expect(webpush.setVapidDetails).not.toHaveBeenCalled()
    })
  })

  describe('validate', () => {
    let provider: WebPushProvider

    beforeEach(() => {
      provider = new WebPushProvider()
    })

    it('should validate envelope with web push recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: {
          web: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
            keys: { p256dh: 'key1', auth: 'key2' },
          },
        },
        channels: ['web'],
        payload: { text: 'Test message' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should throw if no web push recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { email: 'test@example.com' },
        channels: ['web'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).toThrow('At least one recipient must have web push subscription')
    })

    it('should throw if not configured', () => {
      delete process.env.VAPID_PUBLIC_KEY
      const unconfiguredProvider = new WebPushProvider()
      
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: {
          web: {
            endpoint: 'https://...',
            keys: { p256dh: 'key1', auth: 'key2' },
          },
        },
        channels: ['web'],
        payload: { text: 'Test' },
      }

      expect(() => unconfiguredProvider.validate(envelope)).toThrow('Web Push provider is not configured')
    })
  })

  describe('prepare', () => {
    let provider: WebPushProvider

    beforeEach(() => {
      provider = new WebPushProvider()
    })

    it('should prepare message for web push', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: {
          web: {
            endpoint: 'https://fcm.googleapis.com/...',
            keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          },
        },
        channels: ['web'],
        payload: { title: 'Alert', text: 'Test message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('web')
      expect(prepared.data.recipients).toHaveLength(1)
      expect(prepared.data.notification.title).toBe('Alert')
      expect(prepared.data.notification.body).toBe('Test message')
      expect(prepared.data.ttl).toBe(86400)
      expect(prepared.data.urgency).toBe('normal')
    })

    it('should include web overrides', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: {
          web: {
            endpoint: 'https://...',
            keys: { p256dh: 'key', auth: 'key' },
          },
        },
        channels: ['web'],
        payload: { text: 'Test' },
        overrides: {
          web: {
            icon: '/icon.png',
            badge: '/badge.png',
            tag: 'notification-group',
            requireInteraction: true,
            urgency: 'high',
            ttl: 3600,
            actions: [
              { action: 'view', title: 'View' },
            ],
          },
        },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.notification.icon).toBe('/icon.png')
      expect(prepared.data.notification.badge).toBe('/badge.png')
      expect(prepared.data.notification.tag).toBe('notification-group')
      expect(prepared.data.notification.requireInteraction).toBe(true)
      expect(prepared.data.notification.actions).toHaveLength(1)
      expect(prepared.data.urgency).toBe('high')
      expect(prepared.data.ttl).toBe(3600)
    })

    it('should use default title if not provided', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: {
          web: {
            endpoint: 'https://...',
            keys: { p256dh: 'key', auth: 'key' },
          },
        },
        channels: ['web'],
        payload: { text: 'Just text' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.notification.title).toBe('Notification')
    })
  })

  describe('send', () => {
    let provider: WebPushProvider

    beforeEach(() => {
      provider = new WebPushProvider()
    })

    it('should send push notification successfully', async () => {
      vi.mocked(webpush.sendNotification).mockResolvedValue({
        statusCode: 201,
        body: '',
        headers: {},
      })

      const prepared = {
        channel: 'web' as const,
        data: {
          recipients: [{
            endpoint: 'https://fcm.googleapis.com/...',
            keys: { p256dh: 'key1', auth: 'key2' },
          }],
          notification: { title: 'Test', body: 'Message' },
          ttl: 86400,
          urgency: 'normal',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.data?.sent).toBe(1)
    })

    it('should send to multiple recipients', async () => {
      vi.mocked(webpush.sendNotification)
        .mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} })
        .mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} })

      const prepared = {
        channel: 'web' as const,
        data: {
          recipients: [
            { endpoint: 'https://1', keys: { p256dh: 'k1', auth: 'a1' } },
            { endpoint: 'https://2', keys: { p256dh: 'k2', auth: 'a2' } },
          ],
          notification: { title: 'Test', body: 'Message' },
          ttl: 86400,
          urgency: 'normal',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.data?.sent).toBe(2)
    })

    it('should handle expired subscriptions (410)', async () => {
      const error = new Error('Subscription expired')
      ;(error as any).statusCode = 410
      vi.mocked(webpush.sendNotification).mockRejectedValue(error)

      const prepared = {
        channel: 'web' as const,
        data: {
          recipients: [{
            endpoint: 'https://expired',
            keys: { p256dh: 'key', auth: 'auth' },
          }],
          notification: { title: 'Test', body: 'Message' },
          ttl: 86400,
          urgency: 'normal',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(false)
      expect(response.error?.details?.expired).toBe(1)
    })

    it('should handle partial failures', async () => {
      vi.mocked(webpush.sendNotification)
        .mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} })
        .mockRejectedValueOnce(new Error('Failed'))

      const prepared = {
        channel: 'web' as const,
        data: {
          recipients: [
            { endpoint: 'https://1', keys: { p256dh: 'k1', auth: 'a1' } },
            { endpoint: 'https://2', keys: { p256dh: 'k2', auth: 'a2' } },
          ],
          notification: { title: 'Test', body: 'Message' },
          ttl: 86400,
          urgency: 'normal',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.data?.sent).toBe(1)
      expect(response.data?.failed).toBe(1)
    })

    it('should call sendNotification with correct parameters', async () => {
      vi.mocked(webpush.sendNotification).mockResolvedValue({
        statusCode: 201,
        body: '',
        headers: {},
      })

      const prepared = {
        channel: 'web' as const,
        data: {
          recipients: [{
            endpoint: 'https://example.com/push',
            keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          }],
          notification: { title: 'Hello', body: 'World' },
          ttl: 3600,
          urgency: 'high',
        },
      }

      await provider.send(prepared)

      expect(webpush.sendNotification).toHaveBeenCalledWith(
        {
          endpoint: 'https://example.com/push',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        },
        JSON.stringify({ title: 'Hello', body: 'World' }),
        { TTL: 3600, urgency: 'high' }
      )
    })
  })

  describe('mapEvents', () => {
    let provider: WebPushProvider

    beforeEach(() => {
      provider = new WebPushProvider()
    })

    it('should map successful response to succeeded event', () => {
      const response = {
        success: true,
        data: { sent: 1, failed: 0 },
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.succeeded')
      expect(events[0].channel).toBe('web')
      expect(events[0].provider).toBe('web-push')
    })

    it('should map failed response to failed event', () => {
      const response = {
        success: false,
        error: { code: 'WEB_PUSH_ERROR', message: 'Failed' },
      }

      const events = provider.mapEvents(response, 'msg-456')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.failed')
    })
  })

  describe('healthCheck', () => {
    it('should return ok when configured', async () => {
      const provider = new WebPushProvider()
      const result = await provider.healthCheck()

      expect(result.ok).toBe(true)
      expect(result.details?.vapidPublicKeyConfigured).toBe(true)
    })

    it('should return error if public key missing', async () => {
      delete process.env.VAPID_PUBLIC_KEY
      const provider = new WebPushProvider()
      const result = await provider.healthCheck()

      expect(result.ok).toBe(false)
      expect(result.error).toBe('VAPID_PUBLIC_KEY is not configured')
    })

    it('should return error if private key missing', async () => {
      delete process.env.VAPID_PRIVATE_KEY
      const provider = new WebPushProvider()
      const result = await provider.healthCheck()

      expect(result.ok).toBe(false)
      expect(result.error).toBe('VAPID_PRIVATE_KEY is not configured')
    })

    it('should return error if subject missing', async () => {
      delete process.env.VAPID_SUBJECT
      const provider = new WebPushProvider()
      const result = await provider.healthCheck()

      expect(result.ok).toBe(false)
      expect(result.error).toBe('VAPID_SUBJECT is not configured')
    })

    it('should return error if subject format invalid', async () => {
      process.env.VAPID_SUBJECT = 'invalid-format'
      const provider = new WebPushProvider()
      const result = await provider.healthCheck()

      expect(result.ok).toBe(false)
      expect(result.error).toBe('VAPID_SUBJECT must start with mailto: or https://')
    })
  })

  describe('generateVapidKeys', () => {
    it('should generate VAPID keys', () => {
      const keys = WebPushProvider.generateVapidKeys()
      expect(keys.publicKey).toBe('test-public-key')
      expect(keys.privateKey).toBe('test-private-key')
    })
  })
})

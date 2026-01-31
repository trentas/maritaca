import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Envelope } from '@maritaca/core'

// Mock Twilio before importing
vi.mock('twilio', () => {
  const mockCreate = vi.fn()
  const mockFetch = vi.fn()
  
  const Twilio = vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
    },
    api: {
      accounts: vi.fn().mockReturnValue({
        fetch: mockFetch,
      }),
    },
  }))
  
  return {
    Twilio,
    __mockCreate: mockCreate,
    __mockFetch: mockFetch,
    // Provider imports as default: import twilioPkg from 'twilio'
    default: { Twilio },
  }
})

import { TwilioProvider } from '../../../providers/twilio/twilio.js'
import { Twilio, __mockCreate, __mockFetch } from 'twilio'

describe('TwilioProvider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...originalEnv,
      TWILIO_ACCOUNT_SID: 'AC123456789',
      TWILIO_AUTH_TOKEN: 'auth-token-123',
      TWILIO_SMS_FROM: '+15551234567',
      TWILIO_WHATSAPP_FROM: '+15559876543',
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('should create SMS provider with credentials from env', () => {
      const provider = new TwilioProvider({ channel: 'sms' })
      expect(provider.channel).toBe('sms')
      expect(Twilio).toHaveBeenCalledWith('AC123456789', 'auth-token-123')
    })

    it('should create WhatsApp provider', () => {
      const provider = new TwilioProvider({ channel: 'whatsapp' })
      expect(provider.channel).toBe('whatsapp')
    })

    it('should throw if no account SID', () => {
      delete process.env.TWILIO_ACCOUNT_SID
      expect(() => new TwilioProvider()).toThrow('TWILIO_ACCOUNT_SID is required')
    })

    it('should throw if no auth token', () => {
      delete process.env.TWILIO_AUTH_TOKEN
      expect(() => new TwilioProvider()).toThrow('TWILIO_AUTH_TOKEN is required')
    })
  })

  describe('validate (SMS)', () => {
    let provider: TwilioProvider

    beforeEach(() => {
      provider = new TwilioProvider({ channel: 'sms' })
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

    it('should throw if no TWILIO_SMS_FROM', () => {
      delete process.env.TWILIO_SMS_FROM
      const providerNoFrom = new TwilioProvider({ channel: 'sms' })
      
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { sms: { phoneNumber: '+5511999999999' } },
        channels: ['sms'],
        payload: { text: 'Test' },
      }

      expect(() => providerNoFrom.validate(envelope)).toThrow('TWILIO_SMS_FROM is required')
    })
  })

  describe('validate (WhatsApp)', () => {
    let provider: TwilioProvider

    beforeEach(() => {
      provider = new TwilioProvider({ channel: 'whatsapp' })
    })

    it('should validate envelope with WhatsApp recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { whatsapp: { phoneNumber: '+5511999999999' } },
        channels: ['whatsapp'],
        payload: { text: 'Test message' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should throw if no WhatsApp recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { email: 'test@example.com' },
        channels: ['whatsapp'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).toThrow('At least one recipient must have a WhatsApp phone number')
    })

    it('should throw if no TWILIO_WHATSAPP_FROM', () => {
      delete process.env.TWILIO_WHATSAPP_FROM
      const providerNoFrom = new TwilioProvider({ channel: 'whatsapp' })
      
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { whatsapp: { phoneNumber: '+5511999999999' } },
        channels: ['whatsapp'],
        payload: { text: 'Test' },
      }

      expect(() => providerNoFrom.validate(envelope)).toThrow('TWILIO_WHATSAPP_FROM is required')
    })
  })

  describe('prepare (SMS)', () => {
    let provider: TwilioProvider

    beforeEach(() => {
      provider = new TwilioProvider({ channel: 'sms' })
    })

    it('should prepare SMS message', () => {
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
      expect(prepared.data.from).toBe('+15551234567')
      expect(prepared.data.body).toBe('Test message')
    })

    it('should include title in body', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { sms: { phoneNumber: '+5511999999999' } },
        channels: ['sms'],
        payload: { title: 'Alert', text: 'Server down' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.body).toBe('*Alert*\n\nServer down')
    })
  })

  describe('prepare (WhatsApp)', () => {
    let provider: TwilioProvider

    beforeEach(() => {
      provider = new TwilioProvider({ channel: 'whatsapp' })
    })

    it('should prepare WhatsApp message with whatsapp: prefix', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { whatsapp: { phoneNumber: '+5511999999999' } },
        channels: ['whatsapp'],
        payload: { text: 'Test message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('whatsapp')
      expect(prepared.data.from).toBe('whatsapp:+15559876543')
    })

    it('should include contentSid from overrides', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { name: 'Test' },
        recipient: { whatsapp: { phoneNumber: '+5511999999999' } },
        channels: ['whatsapp'],
        payload: { text: 'Test' },
        overrides: {
          whatsapp: { contentSid: 'HX123456' },
        },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.contentSid).toBe('HX123456')
    })
  })

  describe('send', () => {
    let provider: TwilioProvider
    const mockCreate = __mockCreate as ReturnType<typeof vi.fn>

    beforeEach(() => {
      vi.clearAllMocks()
      provider = new TwilioProvider({ channel: 'sms' })
    })

    it('should send SMS successfully', async () => {
      mockCreate.mockResolvedValue({
        sid: 'SM123456',
        status: 'queued',
      })

      const prepared = {
        channel: 'sms' as const,
        data: {
          phoneNumbers: ['+5511999999999'],
          from: '+15551234567',
          body: 'Test message',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.externalId).toBe('SM123456')
      expect(mockCreate).toHaveBeenCalledWith({
        to: '+5511999999999',
        from: '+15551234567',
        body: 'Test message',
      })
    })

    it('should send WhatsApp with whatsapp: prefix', async () => {
      const waProvider = new TwilioProvider({ channel: 'whatsapp' })
      mockCreate.mockResolvedValue({
        sid: 'SM789',
        status: 'queued',
      })

      const prepared = {
        channel: 'whatsapp' as const,
        data: {
          phoneNumbers: ['+5511999999999'],
          from: 'whatsapp:+15559876543',
          body: 'Hello via WhatsApp',
        },
      }

      const response = await waProvider.send(prepared)
      expect(response.success).toBe(true)
      expect(mockCreate).toHaveBeenCalledWith({
        to: 'whatsapp:+5511999999999',
        from: 'whatsapp:+15559876543',
        body: 'Hello via WhatsApp',
      })
    })

    it('should send with contentSid for templates', async () => {
      mockCreate.mockResolvedValue({ sid: 'SM999', status: 'queued' })

      const prepared = {
        channel: 'whatsapp' as const,
        data: {
          phoneNumbers: ['+5511999999999'],
          from: 'whatsapp:+15559876543',
          body: 'Ignored when contentSid is present',
          contentSid: 'HX123',
          contentVariables: { '1': 'John', '2': 'Order123' },
        },
      }

      const waProvider = new TwilioProvider({ channel: 'whatsapp' })
      await waProvider.send(prepared)

      expect(mockCreate).toHaveBeenCalledWith({
        to: 'whatsapp:+5511999999999',
        from: 'whatsapp:+15559876543',
        contentSid: 'HX123',
        contentVariables: JSON.stringify({ '1': 'John', '2': 'Order123' }),
      })
    })

    it('should send with mediaUrl', async () => {
      mockCreate.mockResolvedValue({ sid: 'SM888', status: 'queued' })

      const prepared = {
        channel: 'whatsapp' as const,
        data: {
          phoneNumbers: ['+5511999999999'],
          from: 'whatsapp:+15559876543',
          body: 'Check this image',
          mediaUrl: 'https://example.com/image.jpg',
        },
      }

      const waProvider = new TwilioProvider({ channel: 'whatsapp' })
      await waProvider.send(prepared)

      expect(mockCreate).toHaveBeenCalledWith({
        to: 'whatsapp:+5511999999999',
        from: 'whatsapp:+15559876543',
        body: 'Check this image',
        mediaUrl: ['https://example.com/image.jpg'],
      })
    })

    it('should handle send failure', async () => {
      mockCreate.mockRejectedValue(new Error('Invalid phone number'))

      const prepared = {
        channel: 'sms' as const,
        data: {
          phoneNumbers: ['+invalid'],
          from: '+15551234567',
          body: 'Test',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(false)
      expect(response.error?.code).toBe('TWILIO_ERROR')
    })

    it('should send to multiple recipients', async () => {
      mockCreate
        .mockResolvedValueOnce({ sid: 'SM1', status: 'queued' })
        .mockResolvedValueOnce({ sid: 'SM2', status: 'queued' })

      const prepared = {
        channel: 'sms' as const,
        data: {
          phoneNumbers: ['+5511999999999', '+5511888888888'],
          from: '+15551234567',
          body: 'Broadcast',
        },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
      expect(response.data?.sent).toBe(2)
      expect(response.data?.messageIds).toHaveLength(2)
    })
  })

  describe('mapEvents', () => {
    it('should map successful response to succeeded event', () => {
      const provider = new TwilioProvider({ channel: 'sms' })
      const response = {
        success: true,
        data: { sent: 1 },
        externalId: 'SM123',
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.succeeded')
      expect(events[0].provider).toBe('twilio-sms')
    })

    it('should map WhatsApp events correctly', () => {
      const provider = new TwilioProvider({ channel: 'whatsapp' })
      const response = {
        success: true,
        data: { sent: 1 },
        externalId: 'SM456',
      }

      const events = provider.mapEvents(response, 'msg-456')
      expect(events[0].channel).toBe('whatsapp')
      expect(events[0].provider).toBe('twilio-whatsapp')
    })
  })

  describe('healthCheck', () => {
    const mockFetch = __mockFetch as ReturnType<typeof vi.fn>

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return ok when Twilio is accessible', async () => {
      mockFetch.mockResolvedValue({
        status: 'active',
        friendlyName: 'My Account',
      })

      const provider = new TwilioProvider({ channel: 'sms' })
      const result = await provider.healthCheck()

      expect(result.ok).toBe(true)
      expect(result.details?.accountStatus).toBe('active')
    })

    it('should return error when Twilio is not accessible', async () => {
      mockFetch.mockRejectedValue(new Error('Invalid credentials'))

      const provider = new TwilioProvider({ channel: 'sms' })
      const result = await provider.healthCheck()

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Invalid credentials')
    })

    it('should return error if SMS_FROM not configured', async () => {
      delete process.env.TWILIO_SMS_FROM
      mockFetch.mockResolvedValue({ status: 'active', friendlyName: 'Test' })

      const provider = new TwilioProvider({ channel: 'sms' })
      const result = await provider.healthCheck()

      expect(result.ok).toBe(false)
      expect(result.error).toBe('TWILIO_SMS_FROM is not configured')
    })

    it('should return error if WHATSAPP_FROM not configured for whatsapp', async () => {
      delete process.env.TWILIO_WHATSAPP_FROM
      mockFetch.mockResolvedValue({ status: 'active', friendlyName: 'Test' })

      const provider = new TwilioProvider({ channel: 'whatsapp' })
      const result = await provider.healthCheck()

      expect(result.ok).toBe(false)
      expect(result.error).toBe('TWILIO_WHATSAPP_FROM is not configured')
    })
  })
})

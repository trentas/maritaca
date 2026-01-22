import { describe, it, expect } from 'vitest'
import type { Provider } from '../../providers/base.js'
import type { PreparedMessage, ProviderResponse } from '../../providers/types.js'
import type { Channel, Envelope } from '../../types/envelope.js'

describe('Provider Interface', () => {
  class MockProvider implements Provider {
    channel: Channel = 'email'

    validate(envelope: Envelope): void {
      if (!envelope.payload.text) {
        throw new Error('Text is required')
      }
    }

    prepare(envelope: Envelope): PreparedMessage {
      return {
        channel: 'email',
        data: {
          to: 'test@example.com',
          text: envelope.payload.text,
        },
      }
    }

    async send(prepared: PreparedMessage): Promise<ProviderResponse> {
      return {
        success: true,
        data: { sent: true },
      }
    }

    mapEvents(response: ProviderResponse, messageId: string) {
      return []
    }
  }

  describe('Provider implementation', () => {
    it('should implement all required methods', () => {
      const provider = new MockProvider()
      expect(provider.channel).toBe('email')
      expect(typeof provider.validate).toBe('function')
      expect(typeof provider.prepare).toBe('function')
      expect(typeof provider.send).toBe('function')
      expect(typeof provider.mapEvents).toBe('function')
    })

    it('should validate envelope', () => {
      const provider = new MockProvider()
      const validEnvelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: {},
        channels: ['email'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(validEnvelope)).not.toThrow()
    })

    it('should throw on validation failure', () => {
      const provider = new MockProvider()
      const invalidEnvelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: {},
        channels: ['email'],
        payload: { text: '' },
      }

      expect(() => provider.validate(invalidEnvelope)).toThrow()
    })

    it('should prepare message', () => {
      const provider = new MockProvider()
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: {},
        channels: ['email'],
        payload: { text: 'Test' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('email')
      expect(prepared.data.text).toBe('Test')
    })

    it('should send message', async () => {
      const provider = new MockProvider()
      const prepared: PreparedMessage = {
        channel: 'email',
        data: { to: 'test@example.com', text: 'Test' },
      }

      const response = await provider.send(prepared)
      expect(response.success).toBe(true)
    })

    it('should map events from response', () => {
      const provider = new MockProvider()
      const response: ProviderResponse = {
        success: true,
        data: {},
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(Array.isArray(events)).toBe(true)
    })
  })
})

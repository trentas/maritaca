import { describe, it, expect } from 'vitest'
import {
  validateEnvelope,
  safeValidateEnvelope,
  validateChannel,
  envelopeSchema,
} from '../../validation/envelope.js'
import type { Envelope } from '../../types/envelope.js'

describe('Envelope Validation', () => {
  const validEnvelope: Envelope = {
    idempotencyKey: 'test-key-123',
    sender: {
      name: 'Test Sender',
      email: 'sender@example.com',
    },
    recipient: {
      email: 'recipient@example.com',
    },
    channels: ['email'],
    payload: {
      text: 'Test message',
    },
  }

  describe('validateEnvelope', () => {
    it('should validate a valid envelope', () => {
      const result = validateEnvelope(validEnvelope)
      expect(result).toEqual(validEnvelope)
    })

    it('should throw on missing idempotency key', () => {
      const invalid = { ...validEnvelope, idempotencyKey: '' }
      expect(() => validateEnvelope(invalid)).toThrow()
    })

    it('should throw on missing channels', () => {
      const invalid = { ...validEnvelope, channels: [] }
      expect(() => validateEnvelope(invalid)).toThrow()
    })

    it('should throw on missing text in payload', () => {
      const invalid = {
        ...validEnvelope,
        payload: { text: '' },
      }
      expect(() => validateEnvelope(invalid)).toThrow()
    })

    it('should validate with multiple recipients', () => {
      const multiRecipient = {
        ...validEnvelope,
        recipient: [
          { email: 'recipient1@example.com' },
          { email: 'recipient2@example.com' },
        ],
      }
      const result = validateEnvelope(multiRecipient)
      expect(result.recipient).toHaveLength(2)
    })

    it('should validate with scheduleAt date', () => {
      const scheduled = {
        ...validEnvelope,
        scheduleAt: new Date('2024-12-31T23:59:59Z'),
      }
      const result = validateEnvelope(scheduled)
      expect(result.scheduleAt).toBeInstanceOf(Date)
    })

    it('should validate with priority', () => {
      const highPriority = {
        ...validEnvelope,
        priority: 'high' as const,
      }
      const result = validateEnvelope(highPriority)
      expect(result.priority).toBe('high')
    })
  })

  describe('safeValidateEnvelope', () => {
    it('should return success for valid envelope', () => {
      const result = safeValidateEnvelope(validEnvelope)
      expect(result.success).toBe(true)
      expect(result.data).toEqual(validEnvelope)
      expect(result.error).toBeUndefined()
    })

    it('should return error for invalid envelope', () => {
      const invalid = { ...validEnvelope, idempotencyKey: '' }
      const result = safeValidateEnvelope(invalid)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.data).toBeUndefined()
    })
  })

  describe('validateChannel', () => {
    it('should validate valid channels', () => {
      expect(validateChannel('email')).toBe('email')
      expect(validateChannel('slack')).toBe('slack')
      expect(validateChannel('push')).toBe('push')
      expect(validateChannel('web')).toBe('web')
      expect(validateChannel('sms')).toBe('sms')
    })

    it('should throw on invalid channel', () => {
      expect(() => validateChannel('invalid')).toThrow()
    })
  })

  describe('envelopeSchema', () => {
    it('should accept valid envelope structure', () => {
      const result = envelopeSchema.safeParse(validEnvelope)
      expect(result.success).toBe(true)
    })

    it('should reject invalid email format', () => {
      const invalid = {
        ...validEnvelope,
        sender: { email: 'invalid-email' },
      }
      const result = envelopeSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })
  })
})

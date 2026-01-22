import { describe, it, expect } from 'vitest'
import { maskEmail, maskPhone, maskName, maskLogData, hashPii } from '../../logger/masking.js'

describe('PII Masking', () => {
  describe('maskEmail', () => {
    it('should mask email keeping first char and domain', () => {
      expect(maskEmail('john.doe@example.com')).toBe('j*****@example.com')
    })

    it('should handle short local parts', () => {
      expect(maskEmail('a@example.com')).toBe('a@example.com')
      expect(maskEmail('ab@example.com')).toBe('a*@example.com')
    })

    it('should return [invalid-email] for invalid input', () => {
      expect(maskEmail('')).toBe('[invalid-email]')
      expect(maskEmail('notanemail')).toBe('[invalid-email]')
      expect(maskEmail('@example.com')).toBe('[invalid-email]')
    })
  })

  describe('maskPhone', () => {
    it('should mask phone keeping prefix and suffix', () => {
      expect(maskPhone('+1234567890')).toBe('+1***890')
    })

    it('should handle short phone numbers', () => {
      expect(maskPhone('1234')).toBe('****')
    })

    it('should return [invalid-phone] for invalid input', () => {
      expect(maskPhone('')).toBe('[invalid-phone]')
    })
  })

  describe('maskName', () => {
    it('should mask name keeping first char of each part', () => {
      expect(maskName('John Doe')).toBe('J*** D**')
    })

    it('should handle single names', () => {
      expect(maskName('Madonna')).toBe('M***')
    })

    it('should return [invalid-name] for invalid input', () => {
      expect(maskName('')).toBe('[invalid-name]')
    })
  })

  describe('hashPii', () => {
    it('should return consistent hash for same input', () => {
      const hash1 = hashPii('user@example.com')
      const hash2 = hashPii('user@example.com')
      expect(hash1).toBe(hash2)
    })

    it('should return different hash for different input', () => {
      const hash1 = hashPii('user1@example.com')
      const hash2 = hashPii('user2@example.com')
      expect(hash1).not.toBe(hash2)
    })

    it('should return truncated hash', () => {
      const hash = hashPii('user@example.com')
      expect(hash).toHaveLength(12)
    })

    it('should allow custom length', () => {
      const hash = hashPii('user@example.com', 8)
      expect(hash).toHaveLength(8)
    })
  })

  describe('maskLogData', () => {
    it('should mask email fields', () => {
      const data = { email: 'user@example.com', other: 'value' }
      const masked = maskLogData(data)

      // maskEmail uses min(length-1, 5) asterisks, 'user' has 4 chars so 3 asterisks
      expect(masked.email).toMatch(/^u\*+@example\.com$/)
      expect(masked.other).toBe('value')
    })

    it('should mask to/from fields', () => {
      const data = { to: 'recipient@example.com', from: 'sender@example.com' }
      const masked = maskLogData(data)

      expect(masked.to).toMatch(/^r\*+@example\.com$/)
      expect(masked.from).toMatch(/^s\*+@example\.com$/)
    })

    it('should mask arrays of emails', () => {
      const data = { to: ['alice@example.com', 'bob@example.com'] }
      const masked = maskLogData(data)

      expect(Array.isArray(masked.to)).toBe(true)
      expect((masked.to as string[])[0]).toMatch(/^a\*+@example\.com$/)
      expect((masked.to as string[])[1]).toMatch(/^b\*+@example\.com$/)
    })

    it('should not modify original object', () => {
      const data = { email: 'user@example.com' }
      maskLogData(data)

      expect(data.email).toBe('user@example.com')
    })

    it('should preserve non-PII fields', () => {
      const data = {
        provider: 'resend',
        messageId: 'msg-123',
        success: true,
        count: 5,
      }
      const masked = maskLogData(data)

      expect(masked).toEqual(data)
    })
  })
})

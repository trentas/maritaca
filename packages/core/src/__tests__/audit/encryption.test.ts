import { describe, it, expect } from 'vitest'
import { encryptPii, decryptPii, isEncryptedData } from '../../audit/encryption.js'

describe('PII Encryption', () => {
  const testKey = 'test-encryption-key-for-audit-logs'

  describe('encryptPii', () => {
    it('should encrypt an object', () => {
      const data = { email: 'user@example.com', name: 'John Doe' }
      const encrypted = encryptPii(data, testKey)

      expect(encrypted).toHaveProperty('iv')
      expect(encrypted).toHaveProperty('content')
      expect(encrypted).toHaveProperty('tag')
      expect(encrypted).toHaveProperty('salt')
      expect(encrypted.content).not.toContain('user@example.com')
    })

    it('should produce different ciphertext for same plaintext', () => {
      const data = { email: 'user@example.com' }
      const encrypted1 = encryptPii(data, testKey)
      const encrypted2 = encryptPii(data, testKey)

      // IVs should be different (random)
      expect(encrypted1.iv).not.toBe(encrypted2.iv)
      expect(encrypted1.content).not.toBe(encrypted2.content)
    })

    it('should throw without encryption key', () => {
      const data = { email: 'user@example.com' }
      expect(() => encryptPii(data, '')).toThrow('Encryption key is required')
    })
  })

  describe('decryptPii', () => {
    it('should decrypt encrypted data', () => {
      const original = { email: 'user@example.com', name: 'John Doe' }
      const encrypted = encryptPii(original, testKey)
      const decrypted = decryptPii(encrypted, testKey)

      expect(decrypted).toEqual(original)
    })

    it('should fail with wrong key', () => {
      const data = { email: 'user@example.com' }
      const encrypted = encryptPii(data, testKey)

      expect(() => decryptPii(encrypted, 'wrong-key')).toThrow()
    })

    it('should throw without encryption key', () => {
      const encrypted = encryptPii({ test: true }, testKey)
      expect(() => decryptPii(encrypted, '')).toThrow('Encryption key is required')
    })
  })

  describe('isEncryptedData', () => {
    it('should return true for encrypted data', () => {
      const encrypted = encryptPii({ test: true }, testKey)
      expect(isEncryptedData(encrypted)).toBe(true)
    })

    it('should return false for plain objects', () => {
      expect(isEncryptedData({ email: 'test@example.com' })).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(isEncryptedData(null)).toBe(false)
      expect(isEncryptedData(undefined)).toBe(false)
    })

    it('should return false for incomplete encrypted data', () => {
      expect(isEncryptedData({ iv: 'abc', content: 'def' })).toBe(false)
    })
  })
})

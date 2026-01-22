import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

/**
 * PII Encryption utilities for audit logs
 * 
 * Uses AES-256-GCM for authenticated encryption.
 * The encryption key should be stored securely (e.g., environment variable, secrets manager).
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const SALT_LENGTH = 32

/**
 * Encrypted data structure
 */
export interface EncryptedData {
  /** Initialization vector (hex) */
  iv: string
  /** Encrypted content (hex) */
  content: string
  /** Authentication tag (hex) */
  tag: string
  /** Salt used for key derivation (hex) */
  salt: string
}

/**
 * Derive a 256-bit key from a password/secret
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32)
}

/**
 * Encrypt PII data for storage in audit logs
 * 
 * @param data - Object to encrypt
 * @param encryptionKey - Secret key for encryption (from env var)
 * @returns Encrypted data structure (safe to store in JSONB)
 */
export function encryptPii(
  data: Record<string, unknown>,
  encryptionKey: string,
): EncryptedData {
  if (!encryptionKey) {
    throw new Error('Encryption key is required for PII encryption')
  }

  const salt = randomBytes(SALT_LENGTH)
  const key = deriveKey(encryptionKey, salt)
  const iv = randomBytes(IV_LENGTH)
  
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })
  
  const plaintext = JSON.stringify(data)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  
  return {
    iv: iv.toString('hex'),
    content: encrypted.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    salt: salt.toString('hex'),
  }
}

/**
 * Decrypt PII data from audit logs
 * 
 * @param encrypted - Encrypted data structure
 * @param encryptionKey - Secret key for decryption
 * @returns Decrypted object
 */
export function decryptPii(
  encrypted: EncryptedData,
  encryptionKey: string,
): Record<string, unknown> {
  if (!encryptionKey) {
    throw new Error('Encryption key is required for PII decryption')
  }

  const salt = Buffer.from(encrypted.salt, 'hex')
  const key = deriveKey(encryptionKey, salt)
  const iv = Buffer.from(encrypted.iv, 'hex')
  const content = Buffer.from(encrypted.content, 'hex')
  const tag = Buffer.from(encrypted.tag, 'hex')
  
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })
  decipher.setAuthTag(tag)
  
  const decrypted = Buffer.concat([
    decipher.update(content),
    decipher.final(),
  ])
  
  return JSON.parse(decrypted.toString('utf8'))
}

/**
 * Check if data is encrypted (has the expected structure)
 */
export function isEncryptedData(data: unknown): data is EncryptedData {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj.iv === 'string' &&
    typeof obj.content === 'string' &&
    typeof obj.tag === 'string' &&
    typeof obj.salt === 'string'
  )
}

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import type { EncryptedData } from '../audit/encryption.js'

/**
 * Credential encryption utilities for integration tokens
 *
 * Uses the same AES-256-GCM pattern as audit PII encryption,
 * but with a separate key (INTEGRATION_ENCRYPTION_KEY).
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const SALT_LENGTH = 32

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32)
}

/**
 * Encrypt credentials for storage in the integrations table
 *
 * @param data - Key/value credentials to encrypt (e.g. { botToken: 'xoxb-...' })
 * @param encryptionKey - Secret key (INTEGRATION_ENCRYPTION_KEY)
 * @returns EncryptedData safe for JSONB storage
 */
export function encryptCredentials(
  data: Record<string, string>,
  encryptionKey: string,
): EncryptedData {
  if (!encryptionKey) {
    throw new Error('Encryption key is required for credential encryption')
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
 * Decrypt credentials from the integrations table
 *
 * @param encrypted - EncryptedData from JSONB
 * @param encryptionKey - Secret key (INTEGRATION_ENCRYPTION_KEY)
 * @returns Decrypted credentials object
 */
export function decryptCredentials(
  encrypted: EncryptedData,
  encryptionKey: string,
): Record<string, string> {
  if (!encryptionKey) {
    throw new Error('Encryption key is required for credential decryption')
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

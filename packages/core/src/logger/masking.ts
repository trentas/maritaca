import { createHash } from 'crypto'

/**
 * PII Masking utilities for system logs
 * 
 * These utilities help mask sensitive data before logging to system logs,
 * ensuring GDPR/LGPD compliance while maintaining debugging capability.
 */

/**
 * Mask an email address for logging
 * Example: "john.doe@company.com" -> "j***@company.com"
 * 
 * @param email - Email address to mask
 * @returns Masked email
 */
export function maskEmail(email: string): string {
  if (!email || typeof email !== 'string') return '[invalid-email]'
  
  const atIndex = email.indexOf('@')
  if (atIndex <= 0) return '[invalid-email]'
  
  const local = email.slice(0, atIndex)
  const domain = email.slice(atIndex + 1)
  
  // Keep first character of local part
  const maskedLocal = local.length > 1 
    ? `${local[0]}${'*'.repeat(Math.min(local.length - 1, 5))}`
    : local
  
  return `${maskedLocal}@${domain}`
}

/**
 * Hash a value for pseudonymization
 * Useful for creating consistent identifiers without revealing PII
 * 
 * @param value - Value to hash
 * @param length - Number of characters to return (default: 12)
 * @returns Truncated SHA-256 hash
 */
export function hashPii(value: string, length: number = 12): string {
  if (!value || typeof value !== 'string') return '[invalid]'
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

/**
 * Mask a phone number
 * Example: "+1234567890" -> "+1***890"
 */
export function maskPhone(phone: string): string {
  if (!phone || typeof phone !== 'string') return '[invalid-phone]'
  if (phone.length <= 4) return '****'
  
  const prefix = phone.slice(0, 2)
  const suffix = phone.slice(-3)
  return `${prefix}***${suffix}`
}

/**
 * Mask a name
 * Example: "John Doe" -> "J*** D***"
 */
export function maskName(name: string): string {
  if (!name || typeof name !== 'string') return '[invalid-name]'
  
  return name.split(' ')
    .map(part => part.length > 0 ? `${part[0]}${'*'.repeat(Math.min(part.length - 1, 3))}` : '')
    .join(' ')
}

/**
 * List of fields that should be masked in log data
 */
const PII_FIELDS = [
  'email',
  'to',
  'from',
  'recipient',
  'recipients',
  'sender',
  'phone',
  'name',
  'firstName',
  'lastName',
  'fullName',
] as const

/**
 * Mask PII fields in a log data object
 * Creates a shallow copy with PII fields masked
 * 
 * @param data - Object containing potential PII
 * @returns New object with PII masked
 */
export function maskLogData<T extends Record<string, unknown>>(data: T): T {
  const masked = { ...data } as Record<string, unknown>
  
  for (const key of Object.keys(masked)) {
    const value = masked[key]
    
    // Handle arrays (e.g., `to: ['a@b.com', 'c@d.com']`)
    if (Array.isArray(value)) {
      if (key === 'to' || key === 'recipients' || key === 'cc' || key === 'bcc') {
        masked[key] = value.map(v => typeof v === 'string' ? maskEmail(v) : v)
      }
      continue
    }
    
    // Handle string values
    if (typeof value !== 'string') continue
    
    // Mask based on field name
    if (key === 'email' || key === 'to' || key === 'from' || key === 'sender') {
      masked[key] = maskEmail(value)
    } else if (key === 'phone') {
      masked[key] = maskPhone(value)
    } else if (key === 'name' || key === 'firstName' || key === 'lastName' || key === 'fullName') {
      masked[key] = maskName(value)
    }
  }
  
  return masked as T
}

/**
 * Create a masked copy of an object, recursively
 * Use for deeply nested objects
 */
export function maskLogDataDeep(data: unknown): unknown {
  if (data === null || data === undefined) return data
  
  if (Array.isArray(data)) {
    return data.map(maskLogDataDeep)
  }
  
  if (typeof data === 'object') {
    const masked: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        if (key === 'email' || key === 'to' || key === 'from' || key === 'sender') {
          masked[key] = maskEmail(value)
        } else if (key === 'phone') {
          masked[key] = maskPhone(value)
        } else if (key === 'name' || key === 'firstName' || key === 'lastName') {
          masked[key] = maskName(value)
        } else {
          masked[key] = value
        }
      } else {
        masked[key] = maskLogDataDeep(value)
      }
    }
    return masked
  }
  
  return data
}

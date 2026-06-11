import { describe, it, expect } from 'vitest'
import { verifyAdminKey, createAdminAuthOnRequestHandler } from '../../middleware/adminAuth.js'

describe('verifyAdminKey', () => {
  it('returns true for an exact match', () => {
    expect(verifyAdminKey('s3cret-admin-key', 's3cret-admin-key')).toBe(true)
  })

  it('returns false for a mismatch of equal length', () => {
    expect(verifyAdminKey('s3cret-admin-keX', 's3cret-admin-key')).toBe(false)
  })

  it('returns false for different-length values without throwing', () => {
    expect(verifyAdminKey('short', 'a-much-longer-admin-secret')).toBe(false)
  })

  it('returns false when either value is empty', () => {
    expect(verifyAdminKey('', 's3cret')).toBe(false)
    expect(verifyAdminKey('s3cret', '')).toBe(false)
  })
})

describe('createAdminAuthOnRequestHandler', () => {
  it('returns a handler function', () => {
    expect(typeof createAdminAuthOnRequestHandler()).toBe('function')
  })
})

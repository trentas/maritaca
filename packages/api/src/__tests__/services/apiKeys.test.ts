import { describe, it, expect, vi } from 'vitest'
import bcrypt from 'bcrypt'
import { createApiKey, listApiKeys, revokeApiKey, generateKeyPrefix } from '../../services/apiKeys.js'

describe('generateKeyPrefix', () => {
  it('returns the first 16 chars of the SHA-256 hex digest', () => {
    expect(generateKeyPrefix('maritaca_abc')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic for the same input', () => {
    expect(generateKeyPrefix('x')).toBe(generateKeyPrefix('x'))
  })
})

describe('createApiKey', () => {
  it('stores a bcrypt hash + lookup prefix bound to the project and returns the plaintext once', async () => {
    let inserted: { keyHash: string; keyPrefix: string; projectId: string } | undefined
    const db = {
      insert: () => ({
        values: (v: { keyHash: string; keyPrefix: string; projectId: string }) => {
          inserted = v
          return {
            returning: async () => [
              {
                id: 'key_1',
                projectId: v.projectId,
                keyPrefix: v.keyPrefix,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
              },
            ],
          }
        },
      }),
    } as any

    const result = await createApiKey(db, 'tenant-a')

    expect(result.id).toBe('key_1')
    expect(result.projectId).toBe('tenant-a')
    expect(result.apiKey).toMatch(/^maritaca_/)
    expect(result.keyPrefix).toBe(generateKeyPrefix(result.apiKey))
    expect(result.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))

    // The stored hash is a bcrypt hash of the plaintext, not the plaintext itself.
    expect(inserted?.projectId).toBe('tenant-a')
    expect(inserted?.keyHash).not.toBe(result.apiKey)
    expect(await bcrypt.compare(result.apiKey, inserted!.keyHash)).toBe(true)
  })
})

describe('listApiKeys', () => {
  it('selects project-scoped metadata ordered by createdAt desc', async () => {
    const rows = [{ id: 'key_2', projectId: 'tenant-a', keyPrefix: 'abcd1234abcd1234', createdAt: new Date() }]
    const orderBy = vi.fn(async () => rows)
    const where = vi.fn(() => ({ orderBy }))
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    const db = { select } as any

    const result = await listApiKeys(db, 'tenant-a')

    expect(result).toBe(rows)
    expect(select).toHaveBeenCalledOnce()
    expect(orderBy).toHaveBeenCalledOnce()
  })
})

describe('revokeApiKey', () => {
  it('returns true when a row is deleted', async () => {
    const db = { delete: () => ({ where: () => ({ returning: async () => [{ id: 'key_3' }] }) }) } as any
    expect(await revokeApiKey(db, 'key_3')).toBe(true)
  })

  it('returns false when no row matches', async () => {
    const db = { delete: () => ({ where: () => ({ returning: async () => [] }) }) } as any
    expect(await revokeApiKey(db, 'nope')).toBe(false)
  })
})

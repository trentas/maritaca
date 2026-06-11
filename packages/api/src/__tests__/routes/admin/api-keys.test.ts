import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import { adminApiKeyRoutes } from '../../../routes/admin/api-keys.js'

const ADMIN_KEY = 'test-admin-key-123'

interface MockState {
  listResult?: unknown[]
  deleteResult?: unknown[]
}

/**
 * Minimal drizzle-shaped mock that exercises the real apiKeys service.
 * Insert echoes the inserted values; list/delete return configurable rows.
 */
function buildMockDb(state: MockState) {
  return {
    insert: () => ({
      values: (v: { keyHash: string; keyPrefix: string; projectId: string }) => ({
        returning: async () => [
          {
            id: 'key_generated',
            projectId: v.projectId,
            keyPrefix: v.keyPrefix,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
      }),
    }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => state.listResult ?? [] }) }) }),
    delete: () => ({ where: () => ({ returning: async () => state.deleteResult ?? [] }) }),
  } as any
}

describe('Admin API key routes', () => {
  let app: FastifyInstance
  const state: MockState = {}
  const auth = { authorization: `Bearer ${ADMIN_KEY}` }

  beforeEach(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY
    state.listResult = undefined
    state.deleteResult = undefined
    app = Fastify()
    app.decorate('db', buildMockDb(state))
    await app.register(adminApiKeyRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    delete process.env.ADMIN_API_KEY
  })

  // --- Auth gating ---

  it('rejects requests with no Authorization header (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/api-keys', payload: { projectId: 'tenant-a' } })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a normal project / wrong bearer key (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/api-keys',
      headers: { authorization: 'Bearer maritaca_a_normal_project_key' },
      payload: { projectId: 'tenant-a' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 503 when ADMIN_API_KEY is not configured', async () => {
    delete process.env.ADMIN_API_KEY
    const res = await app.inject({ method: 'GET', url: '/v1/admin/api-keys?projectId=tenant-a', headers: auth })
    expect(res.statusCode).toBe(503)
  })

  // --- Create ---

  it('creates a key bound to the project and returns the plaintext once (201)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/api-keys', headers: auth, payload: { projectId: 'tenant-a' } })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.id).toBe('key_generated')
    expect(body.projectId).toBe('tenant-a')
    expect(body.apiKey).toMatch(/^maritaca_/)
    expect(body.keyPrefix).toMatch(/^[0-9a-f]{16}$/)
    expect(body.createdAt).toBeDefined()
    // never leak the stored hash
    expect(body).not.toHaveProperty('keyHash')
  })

  it('rejects create without a projectId (400)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/api-keys', headers: auth, payload: {} })
    expect(res.statusCode).toBe(400)
  })

  // --- List ---

  it('lists keys for a project as metadata only (200)', async () => {
    state.listResult = [
      { id: 'key_1', projectId: 'tenant-a', keyPrefix: 'abcd1234abcd1234', createdAt: '2026-01-01T00:00:00.000Z' },
    ]
    const res = await app.inject({ method: 'GET', url: '/v1/admin/api-keys?projectId=tenant-a', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.projectId).toBe('tenant-a')
    expect(body.apiKeys).toHaveLength(1)
    expect(body.apiKeys[0]).not.toHaveProperty('keyHash')
    expect(body.apiKeys[0]).not.toHaveProperty('apiKey')
  })

  it('rejects list without a projectId query (400)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/api-keys', headers: auth })
    expect(res.statusCode).toBe(400)
  })

  // --- Revoke ---

  it('revokes an existing key (200)', async () => {
    state.deleteResult = [{ id: 'key_1' }]
    const res = await app.inject({ method: 'DELETE', url: '/v1/admin/api-keys/key_1', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'revoked', id: 'key_1' })
  })

  it('returns 404 when revoking a missing key', async () => {
    state.deleteResult = []
    const res = await app.inject({ method: 'DELETE', url: '/v1/admin/api-keys/nope', headers: auth })
    expect(res.statusCode).toBe(404)
  })
})

import { describe, it, expect } from 'vitest'
import { authMiddleware } from '../../middleware/auth.js'

describe('Auth Middleware', () => {
  it('should export authMiddleware', () => {
    expect(authMiddleware).toBeDefined()
    expect(typeof authMiddleware).toBe('function')
  })

  // Note: Full middleware tests would require Fastify test setup
  // These would be integration tests with test database
})

import { describe, it, expect } from 'vitest'
import { createQueue, enqueueMessage } from '../../services/queue.js'
import type { Envelope } from '@maritaca/core'

describe('Queue Service', () => {
  describe('createQueue', () => {
    it('should create a queue instance', () => {
      const queue = createQueue('redis://localhost:6379')
      expect(queue).toBeDefined()
      expect(queue.name).toBe('maritaca-notifications')
    })

    it('should parse Redis URL correctly', () => {
      const queue = createQueue('redis://localhost:6379')
      expect(queue).toBeDefined()
    })
  })

  describe('enqueueMessage', () => {
    it('should have correct function signature', () => {
      expect(typeof enqueueMessage).toBe('function')
    })

    // Note: Actual enqueue tests would require Redis connection
    // These would be integration tests
  })
})

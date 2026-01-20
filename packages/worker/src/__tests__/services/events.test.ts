import { describe, it, expect } from 'vitest'
import { emitEvent, getMessageEvents } from '../../services/events.js'

describe('Events Service', () => {
  describe('emitEvent', () => {
    it('should have correct function signature', () => {
      expect(typeof emitEvent).toBe('function')
    })
  })

  describe('getMessageEvents', () => {
    it('should have correct function signature', () => {
      expect(typeof getMessageEvents).toBe('function')
    })
  })
})

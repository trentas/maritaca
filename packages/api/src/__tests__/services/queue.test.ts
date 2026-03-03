import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createQueue, enqueueMessage, calculateDelay } from '../../services/queue.js'
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

  describe('calculateDelay', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return 0 when scheduleAt is undefined', () => {
      expect(calculateDelay(undefined)).toBe(0)
    })

    it('should return 0 when scheduleAt is in the past', () => {
      vi.setSystemTime(new Date('2024-02-24T10:00:00Z'))
      const past = new Date('2024-02-24T09:00:00Z')
      expect(calculateDelay(past)).toBe(0)
    })

    it('should return correct delay for future scheduleAt', () => {
      vi.setSystemTime(new Date('2024-02-24T02:00:00Z'))
      const future = new Date('2024-02-24T09:00:00Z')
      const delay = calculateDelay(future)
      // 7 hours = 25,200,000 ms
      expect(delay).toBe(7 * 60 * 60 * 1000)
    })

    it('should return correct delay for scheduleAt 1 minute in the future', () => {
      vi.setSystemTime(new Date('2024-02-24T08:59:00Z'))
      const future = new Date('2024-02-24T09:00:00Z')
      expect(calculateDelay(future)).toBe(60_000)
    })

    it('should return 0 when scheduleAt is exactly now', () => {
      const now = new Date('2024-02-24T09:00:00Z')
      vi.setSystemTime(now)
      expect(calculateDelay(new Date('2024-02-24T09:00:00Z'))).toBe(0)
    })

    it('should handle scheduleAt as ISO string coerced to Date', () => {
      vi.setSystemTime(new Date('2024-02-24T02:00:00Z'))
      // Simulates what z.coerce.date() produces from an ISO string
      const scheduled = new Date('2024-02-24T09:00:00Z')
      expect(calculateDelay(scheduled)).toBe(7 * 60 * 60 * 1000)
    })

    it('should handle timezone-aware ISO strings', () => {
      vi.setSystemTime(new Date('2024-02-24T05:00:00Z')) // 2am BRT = 5am UTC
      // 9am BRT = 12pm UTC
      const scheduled = new Date('2024-02-24T09:00:00-03:00')
      // Expected: 12pm UTC - 5am UTC = 7 hours
      expect(calculateDelay(scheduled)).toBe(7 * 60 * 60 * 1000)
    })
  })

  describe('enqueueMessage', () => {
    it('should have correct function signature', () => {
      expect(typeof enqueueMessage).toBe('function')
    })

    it('should enqueue with delay when scheduleAt is in the future', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-02-24T02:00:00Z'))

      const addedJobs: { name: string; data: any; opts: any }[] = []
      const mockQueue = {
        add: vi.fn(async (name: string, data: any, opts: any) => {
          addedJobs.push({ name, data, opts })
          return { id: '1' }
        }),
      } as any

      const envelope: Envelope = {
        idempotencyKey: 'test-key',
        sender: { name: 'Test', email: 'test@test.com' },
        recipient: { email: 'user@test.com' },
        channels: ['email'],
        payload: { text: 'Hello' },
        scheduleAt: new Date('2024-02-24T09:00:00Z'),
      }

      await enqueueMessage(mockQueue, 'msg-1', envelope, 'proj-1')

      expect(mockQueue.add).toHaveBeenCalledTimes(1)
      expect(addedJobs[0].opts.delay).toBe(7 * 60 * 60 * 1000)

      vi.useRealTimers()
    })

    it('should enqueue without delay when no scheduleAt', async () => {
      const addedJobs: { name: string; data: any; opts: any }[] = []
      const mockQueue = {
        add: vi.fn(async (name: string, data: any, opts: any) => {
          addedJobs.push({ name, data, opts })
          return { id: '1' }
        }),
      } as any

      const envelope: Envelope = {
        idempotencyKey: 'test-key',
        sender: { name: 'Test', email: 'test@test.com' },
        recipient: { email: 'user@test.com' },
        channels: ['email'],
        payload: { text: 'Hello' },
      }

      await enqueueMessage(mockQueue, 'msg-1', envelope, 'proj-1')

      expect(mockQueue.add).toHaveBeenCalledTimes(1)
      expect(addedJobs[0].opts.delay).toBeUndefined()
    })

    it('should enqueue one job per channel', async () => {
      const mockQueue = {
        add: vi.fn(async () => ({ id: '1' })),
      } as any

      const envelope: Envelope = {
        idempotencyKey: 'test-key',
        sender: { name: 'Test', email: 'test@test.com' },
        recipient: { email: 'user@test.com', sms: { phoneNumber: '+5511999999999' } },
        channels: ['email', 'sms'],
        payload: { text: 'Hello' },
      }

      await enqueueMessage(mockQueue, 'msg-1', envelope, 'proj-1')

      expect(mockQueue.add).toHaveBeenCalledTimes(2)
      expect(mockQueue.add).toHaveBeenCalledWith(
        'channel-email',
        expect.objectContaining({ messageId: 'msg-1', channel: 'email' }),
        expect.any(Object),
      )
      expect(mockQueue.add).toHaveBeenCalledWith(
        'channel-sms',
        expect.objectContaining({ messageId: 'msg-1', channel: 'sms' }),
        expect.any(Object),
      )
    })

    it('should set priority based on envelope.priority', async () => {
      const addedJobs: { opts: any }[] = []
      const mockQueue = {
        add: vi.fn(async (_name: string, _data: any, opts: any) => {
          addedJobs.push({ opts })
          return { id: '1' }
        }),
      } as any

      const makeEnvelope = (priority?: 'low' | 'normal' | 'high'): Envelope => ({
        idempotencyKey: `test-${priority}`,
        sender: { name: 'Test', email: 'test@test.com' },
        recipient: { email: 'user@test.com' },
        channels: ['email'],
        payload: { text: 'Hello' },
        priority,
      })

      await enqueueMessage(mockQueue, 'msg-high', makeEnvelope('high'), 'proj-1')
      await enqueueMessage(mockQueue, 'msg-normal', makeEnvelope('normal'), 'proj-1')
      await enqueueMessage(mockQueue, 'msg-low', makeEnvelope('low'), 'proj-1')

      expect(addedJobs[0].opts.priority).toBe(1)   // high
      expect(addedJobs[1].opts.priority).toBe(5)   // normal
      expect(addedJobs[2].opts.priority).toBe(10)  // low
    })

    it('should log scheduling info when logger is provided', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-02-24T02:00:00Z'))

      const mockQueue = {
        add: vi.fn(async () => ({ id: '1' })),
      } as any

      const mockLogger = {
        info: vi.fn(),
      } as any

      const envelope: Envelope = {
        idempotencyKey: 'test-key',
        sender: { name: 'Test', email: 'test@test.com' },
        recipient: { email: 'user@test.com' },
        channels: ['email'],
        payload: { text: 'Hello' },
        scheduleAt: new Date('2024-02-24T09:00:00Z'),
      }

      await enqueueMessage(mockQueue, 'msg-1', envelope, 'proj-1', mockLogger)

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-1',
          delayMs: 7 * 60 * 60 * 1000,
          scheduled: true,
        }),
        'Scheduling message with delay',
      )

      vi.useRealTimers()
    })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SlackProvider } from '../../providers/slack.js'
import type { Envelope } from '@maritaca/core'

describe('Slack Provider', () => {
  let provider: SlackProvider
  let originalToken: string | undefined

  beforeEach(() => {
    provider = new SlackProvider()
    vi.clearAllMocks()
    // Save original token and set a test token
    originalToken = process.env.SLACK_BOT_TOKEN
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token'
  })

  afterEach(() => {
    // Restore original token
    if (originalToken) {
      process.env.SLACK_BOT_TOKEN = originalToken
    } else {
      delete process.env.SLACK_BOT_TOKEN
    }
  })

  describe('validate', () => {
    it('should validate envelope with Slack userId recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { userId: 'U123' } },
        channels: ['slack'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should validate envelope with Slack channelId recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { channelId: 'C123' } },
        channels: ['slack'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should validate envelope with Slack channelName recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { channelName: 'general' } },
        channels: ['slack'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should validate envelope with Slack email recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { email: 'user@example.com' } },
        channels: ['slack'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).not.toThrow()
    })

    it('should throw if no Slack recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { email: 'test@example.com' },
        channels: ['slack'],
        payload: { text: 'Test' },
      }

      expect(() => provider.validate(envelope)).toThrow('At least one recipient must have a Slack identifier')
    })

    it('should throw if SLACK_BOT_TOKEN env var is not set', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { userId: 'U123' } },
        channels: ['slack'],
        payload: { text: 'Test' },
      }

      // Clear env var for this test
      delete process.env.SLACK_BOT_TOKEN

      expect(() => provider.validate(envelope)).toThrow('SLACK_BOT_TOKEN environment variable is required')
    })
  })

  describe('prepare', () => {
    it('should prepare message for Slack using userId', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { userId: 'U123' } },
        channels: ['slack'],
        payload: { text: 'Test message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('slack')
      expect(prepared.data.recipientInfo.directTargets).toContain('U123')
      expect(prepared.data.text).toBe('Test message')
      expect(prepared.data.botToken).toBe('xoxb-test-token')
    })

    it('should prepare message for Slack using channelId', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { channelId: 'C456' } },
        channels: ['slack'],
        payload: { text: 'Channel message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('slack')
      expect(prepared.data.recipientInfo.directTargets).toContain('C456')
      expect(prepared.data.text).toBe('Channel message')
    })

    it('should prepare message for Slack using channelName', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { channelName: 'general' } },
        channels: ['slack'],
        payload: { text: 'Channel name message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('slack')
      expect(prepared.data.recipientInfo.channelNames).toContain('general')
    })

    it('should prepare message for Slack using channelName with # prefix', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { channelName: '#announcements' } },
        channels: ['slack'],
        payload: { text: 'Announcement' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.recipientInfo.channelNames).toContain('#announcements')
    })

    it('should prepare message for Slack using email', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { email: 'user@example.com' } },
        channels: ['slack'],
        payload: { text: 'Email lookup message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('slack')
      expect(prepared.data.recipientInfo.emails).toContain('user@example.com')
    })

    it('should prepare message for mixed recipient types', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: [
          { slack: { userId: 'U123' } },
          { slack: { channelId: 'C456' } },
          { slack: { channelName: 'general' } },
          { slack: { email: 'user@example.com' } },
        ],
        channels: ['slack'],
        payload: { text: 'Mixed message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.recipientInfo.directTargets).toContain('U123')
      expect(prepared.data.recipientInfo.directTargets).toContain('C456')
      expect(prepared.data.recipientInfo.channelNames).toContain('general')
      expect(prepared.data.recipientInfo.emails).toContain('user@example.com')
    })

    it('should include title in text if provided', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { userId: 'U123' } },
        channels: ['slack'],
        payload: { title: 'Title', text: 'Body' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.data.text).toContain('Title')
      expect(prepared.data.text).toContain('Body')
    })
  })

  describe('mapEvents', () => {
    it('should map successful response to events', () => {
      const response = {
        success: true,
        data: { sent: 1 },
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.succeeded')
      expect(events[0].messageId).toBe('msg-123')
    })

    it('should map failed response to events', () => {
      const response = {
        success: false,
        error: { message: 'Error' },
      }

      const events = provider.mapEvents(response, 'msg-123')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('attempt.failed')
    })
  })

  describe('email cache', () => {
    it('should start with empty cache', () => {
      const stats = provider.getEmailCacheStats()
      expect(stats.size).toBe(0)
      expect(stats.maxSize).toBe(1000) // default max size
      expect(stats.emails).toHaveLength(0)
    })

    it('should clear cache when clearEmailCache is called', () => {
      // We can't easily populate the cache without mocking the Slack API,
      // but we can verify the clear method exists and works
      provider.clearEmailCache()
      const stats = provider.getEmailCacheStats()
      expect(stats.size).toBe(0)
    })

    it('should accept custom cache size and TTL', () => {
      const customProvider = new SlackProvider({ 
        cacheMaxSize: 500,
        cacheTtlMs: 60000,
      })
      const stats = customProvider.getEmailCacheStats()
      expect(stats.maxSize).toBe(500)
    })

    it('should accept custom retry config', () => {
      const customProvider = new SlackProvider({ 
        retryConfig: { maxRetries: 5 },
        cacheTtlMs: 30000,
      })
      expect(customProvider).toBeInstanceOf(SlackProvider)
    })
  })

  describe('healthCheck', () => {
    it('should return error when SLACK_BOT_TOKEN is not set', async () => {
      delete process.env.SLACK_BOT_TOKEN
      
      const result = await provider.healthCheck()
      expect(result.ok).toBe(false)
      expect(result.error).toContain('SLACK_BOT_TOKEN')
    })

    it('should have healthCheck method', () => {
      expect(typeof provider.healthCheck).toBe('function')
    })
  })
})

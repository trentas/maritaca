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
    it('should validate envelope with Slack recipient and env token', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { userId: 'U123' } },
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

      expect(() => provider.validate(envelope)).toThrow('At least one recipient must have a Slack user ID')
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
    it('should prepare message for Slack using env token', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { userId: 'U123' } },
        channels: ['slack'],
        payload: { text: 'Test message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('slack')
      expect(prepared.data.userIds).toContain('U123')
      expect(prepared.data.text).toBe('Test message')
      expect(prepared.data.botToken).toBe('xoxb-test-token')
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
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SlackProvider } from '../../providers/slack.js'
import type { Envelope } from '@maritaca/core'

describe('Slack Provider', () => {
  let provider: SlackProvider

  beforeEach(() => {
    provider = new SlackProvider()
    vi.clearAllMocks()
  })

  describe('validate', () => {
    it('should validate envelope with Slack recipient', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { slack: { botToken: 'xoxb-token' } },
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

      expect(() => provider.validate(envelope)).toThrow()
    })

    it('should throw if no bot token', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: {},
        recipient: { slack: { userId: 'U123' } },
        channels: ['slack'],
        payload: { text: 'Test' },
      }

      // Clear env var for this test
      const originalToken = process.env.SLACK_BOT_TOKEN
      delete process.env.SLACK_BOT_TOKEN

      expect(() => provider.validate(envelope)).toThrow()

      if (originalToken) {
        process.env.SLACK_BOT_TOKEN = originalToken
      }
    })
  })

  describe('prepare', () => {
    it('should prepare message for Slack', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { slack: { botToken: 'xoxb-token' } },
        recipient: { slack: { userId: 'U123' } },
        channels: ['slack'],
        payload: { text: 'Test message' },
      }

      const prepared = provider.prepare(envelope)
      expect(prepared.channel).toBe('slack')
      expect(prepared.data.userIds).toContain('U123')
      expect(prepared.data.text).toBe('Test message')
    })

    it('should include title in text if provided', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key',
        sender: { slack: { botToken: 'xoxb-token' } },
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

import { describe, it, expect } from 'vitest'
import type {
  Envelope,
  Sender,
  Recipient,
  Payload,
  Channel,
  MessagePriority,
} from '../../types/envelope.js'

describe('Envelope Types', () => {
  describe('Channel type', () => {
    it('should accept valid channel values', () => {
      const channels: Channel[] = ['email', 'slack', 'push', 'web', 'sms']
      expect(channels).toHaveLength(5)
    })
  })

  describe('Sender interface', () => {
    it('should accept minimal sender', () => {
      const sender: Sender = {}
      expect(sender).toBeDefined()
    })

    it('should accept sender with name and email', () => {
      const sender: Sender = {
        name: 'Test Sender',
        email: 'sender@example.com',
      }
      expect(sender.name).toBe('Test Sender')
      expect(sender.email).toBe('sender@example.com')
    })

    it('should accept sender with Slack config', () => {
      const sender: Sender = {
        slack: {
          botToken: 'xoxb-token',
        },
      }
      expect(sender.slack?.botToken).toBe('xoxb-token')
    })
  })

  describe('Recipient interface', () => {
    it('should accept minimal recipient', () => {
      const recipient: Recipient = {}
      expect(recipient).toBeDefined()
    })

    it('should accept recipient with email', () => {
      const recipient: Recipient = {
        email: 'recipient@example.com',
      }
      expect(recipient.email).toBe('recipient@example.com')
    })

    it('should accept recipient with Slack user ID', () => {
      const recipient: Recipient = {
        slack: {
          userId: 'U123456',
        },
      }
      expect(recipient.slack?.userId).toBe('U123456')
    })
  })

  describe('Payload interface', () => {
    it('should require text field', () => {
      const payload: Payload = {
        text: 'Required text',
      }
      expect(payload.text).toBe('Required text')
    })

    it('should accept optional title and html', () => {
      const payload: Payload = {
        title: 'Title',
        text: 'Text',
        html: '<p>HTML</p>',
      }
      expect(payload.title).toBe('Title')
      expect(payload.html).toBe('<p>HTML</p>')
    })
  })

  describe('Envelope interface', () => {
    it('should create valid envelope', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key-123',
        sender: { name: 'Sender' },
        recipient: { email: 'recipient@example.com' },
        channels: ['email'],
        payload: { text: 'Message' },
      }
      expect(envelope.idempotencyKey).toBe('key-123')
      expect(envelope.channels).toContain('email')
    })

    it('should accept array of recipients', () => {
      const envelope: Envelope = {
        idempotencyKey: 'key-123',
        sender: { name: 'Sender' },
        recipient: [
          { email: 'recipient1@example.com' },
          { email: 'recipient2@example.com' },
        ],
        channels: ['email'],
        payload: { text: 'Message' },
      }
      expect(Array.isArray(envelope.recipient)).toBe(true)
    })

    it('should accept priority', () => {
      const priorities: MessagePriority[] = ['low', 'normal', 'high']
      priorities.forEach((priority) => {
        const envelope: Envelope = {
          idempotencyKey: 'key-123',
          sender: { name: 'Sender' },
          recipient: { email: 'recipient@example.com' },
          channels: ['email'],
          payload: { text: 'Message' },
          priority,
        }
        expect(envelope.priority).toBe(priority)
      })
    })
  })
})

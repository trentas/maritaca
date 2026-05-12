import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Provider, ProviderResponse, Envelope } from '@maritaca/core'
import { FailoverEmailProvider } from '../../../providers/email/failover.js'

const mockResendSend = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockResendSend } })),
}))

const mockMandrillSend = vi.fn()
vi.mock('@mailchimp/mailchimp_transactional', () => ({
  default: vi.fn(() => ({
    messages: { send: mockMandrillSend },
    users: { ping: vi.fn() },
  })),
}))

function makeProvider(name: string, send: () => Promise<ProviderResponse> | ProviderResponse): Provider {
  return {
    name,
    channel: 'email',
    validate: vi.fn(),
    prepare: vi.fn(() => ({ channel: 'email', data: {} })) as Provider['prepare'],
    send: vi.fn(send) as Provider['send'],
    mapEvents: vi.fn(() => []) as Provider['mapEvents'],
  }
}

const envelope: Envelope = {
  idempotencyKey: 'k',
  sender: { email: 'sender@example.com' },
  recipient: { email: 'rcpt@example.com' },
  channels: ['email'],
  payload: { text: 'Hi' },
}

function dispatch(fp: FailoverEmailProvider) {
  return fp.send(fp.prepare(envelope))
}

describe('FailoverEmailProvider', () => {
  it('requires at least one provider', () => {
    expect(() => new FailoverEmailProvider({ providers: [] })).toThrow('at least one provider')
  })

  it('returns the primary response when it succeeds and tags provider + providerUsed', async () => {
    const primary = makeProvider('primary', async () => ({ success: true, externalId: 'p-1' }))
    const fallback = makeProvider('fallback', async () => ({ success: true, externalId: 'f-1' }))

    const fp = new FailoverEmailProvider({ providers: [primary, fallback] })
    const res = await dispatch(fp)

    expect(res.success).toBe(true)
    expect(res.externalId).toBe('p-1')
    expect(res.provider).toBe('primary')
    expect(res.data?.providerUsed).toBe('primary')
    expect(fallback.send).not.toHaveBeenCalled()
  })

  it('falls over to the next provider on transient error', async () => {
    const primary = makeProvider('primary', async () => ({
      success: false,
      error: { code: 'TRANSIENT', message: 'boom' },
    }))
    const fallback = makeProvider('fallback', async () => ({ success: true, externalId: 'f-1' }))

    const fp = new FailoverEmailProvider({ providers: [primary, fallback] })
    const res = await dispatch(fp)

    expect(res.success).toBe(true)
    expect(res.externalId).toBe('f-1')
    expect(res.provider).toBe('fallback')
    expect(res.data?.providerUsed).toBe('fallback')
    expect(primary.send).toHaveBeenCalledOnce()
    expect(fallback.send).toHaveBeenCalledOnce()
  })

  it('does NOT fall over on fatal error codes', async () => {
    const primary = makeProvider('primary', async () => ({
      success: false,
      error: { code: 'validation_error', message: 'bad email' },
    }))
    const fallback = makeProvider('fallback', async () => ({ success: true, externalId: 'f-1' }))

    const fp = new FailoverEmailProvider({ providers: [primary, fallback] })
    const res = await dispatch(fp)

    expect(res.success).toBe(false)
    expect(res.error?.code).toBe('validation_error')
    expect(fallback.send).not.toHaveBeenCalled()
  })

  it('returns FAILOVER_EXHAUSTED when every provider fails transiently', async () => {
    const a = makeProvider('a', async () => ({ success: false, error: { code: 'A_FAIL', message: 'a' } }))
    const b = makeProvider('b', async () => ({ success: false, error: { code: 'B_FAIL', message: 'b' } }))

    const fp = new FailoverEmailProvider({ providers: [a, b] })
    const res = await dispatch(fp)

    expect(res.success).toBe(false)
    expect(res.error?.code).toBe('B_FAIL')
    expect((res.error?.details?.attempts as Array<{ provider: string }>).map((x) => x.provider)).toEqual(['a', 'b'])
  })

  it('treats provider exceptions as transient and retries next', async () => {
    const primary = makeProvider('primary', async () => {
      throw new Error('network down')
    })
    const fallback = makeProvider('fallback', async () => ({ success: true, externalId: 'f-1' }))

    const fp = new FailoverEmailProvider({ providers: [primary, fallback] })
    const res = await dispatch(fp)

    expect(res.success).toBe(true)
    expect(res.data?.providerUsed).toBe('fallback')
  })

  it('mapEvents uses response.provider when present', () => {
    const primary = makeProvider('primary', async () => ({ success: true }))
    const fallback = makeProvider('fallback', async () => ({ success: true }))
    const fp = new FailoverEmailProvider({ providers: [primary, fallback] })

    const events = fp.mapEvents({ success: true, externalId: 'x', provider: 'fallback' }, 'msg-1')
    expect(events[0].provider).toBe('fallback')
    expect(events[0].type).toBe('attempt.succeeded')
  })

  describe('chain with heterogeneous prepared-data shapes', () => {
    const originalEnv = process.env

    beforeEach(() => {
      vi.clearAllMocks()
      process.env = { ...originalEnv, RESEND_API_KEY: 're_test', MANDRILL_API_KEY: 'md_test' }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('falls over from Resend to Mandrill with correct payload shape', async () => {
      // Lazy-import after mocks are set so the SDKs are intercepted
      const { ResendProvider } = await import('../../../providers/email/resend.js')
      const { MandrillProvider } = await import('../../../providers/email/mandrill.js')

      mockResendSend.mockResolvedValue({
        data: null,
        error: { name: 'rate_limit_exceeded', message: 'slow down' },
      })
      mockMandrillSend.mockResolvedValue([
        { email: 'rcpt@example.com', status: 'sent', _id: 'mc-1' },
      ])

      const fp = new FailoverEmailProvider({
        providers: [new ResendProvider(), new MandrillProvider()],
      })

      const envelope: Envelope = {
        idempotencyKey: 'k',
        sender: { name: 'Sender', email: 'sender@example.com' },
        recipient: { email: 'rcpt@example.com' },
        channels: ['email'],
        payload: { title: 'Hi', text: 'body' },
      }

      const dispatcherPrepared = fp.prepare(envelope)
      const res = await fp.send(dispatcherPrepared, { messageId: 'msg-1' })

      expect(res.success).toBe(true)
      expect(res.data?.providerUsed).toBe('mandrill')
      expect(res.externalId).toBe('mc-1')

      // Mandrill must have been called with its own payload shape
      // (from_email + from_name), not Resend's combined `from` string.
      expect(mockMandrillSend).toHaveBeenCalledOnce()
      const callArg = mockMandrillSend.mock.calls[0][0]
      expect(callArg.message.from_email).toBe('sender@example.com')
      expect(callArg.message.from_name).toBe('Sender')
      expect(callArg.message.to).toEqual([{ email: 'rcpt@example.com', type: 'to' }])
    })
  })

  it('validates against every provider in the chain', () => {
    const primary = makeProvider('primary', async () => ({ success: true }))
    const fallback = makeProvider('fallback', async () => ({ success: true }))
    const fp = new FailoverEmailProvider({ providers: [primary, fallback] })

    fp.validate(envelope)

    expect(primary.validate).toHaveBeenCalledOnce()
    expect(fallback.validate).toHaveBeenCalledOnce()
  })

  it('re-prepares per provider on send (does not reuse primary prepared data)', async () => {
    const primary = makeProvider('primary', async () => ({
      success: false,
      error: { code: 'TRANSIENT', message: 'boom' },
    }))
    const fallback = makeProvider('fallback', async () => ({ success: true, externalId: 'f-1' }))
    const fp = new FailoverEmailProvider({ providers: [primary, fallback] })

    await dispatch(fp)

    expect(primary.prepare).toHaveBeenCalledOnce()
    expect(primary.prepare).toHaveBeenCalledWith(envelope)
    expect(fallback.prepare).toHaveBeenCalledOnce()
    expect(fallback.prepare).toHaveBeenCalledWith(envelope)
  })

  it('returns FAILOVER_MISSING_ENVELOPE when send is called without going through prepare', async () => {
    const primary = makeProvider('primary', async () => ({ success: true }))
    const fp = new FailoverEmailProvider({ providers: [primary] })

    const res = await fp.send({ channel: 'email', data: {} })

    expect(res.success).toBe(false)
    expect(res.error?.code).toBe('FAILOVER_MISSING_ENVELOPE')
    expect(primary.send).not.toHaveBeenCalled()
  })
})

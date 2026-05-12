import { describe, it, expect, vi } from 'vitest'
import type { Provider, PreparedMessage, ProviderResponse } from '@maritaca/core'
import { FailoverEmailProvider } from '../../../providers/email/failover.js'

function makeProvider(name: string, send: () => Promise<ProviderResponse> | ProviderResponse): Provider {
  return {
    name,
    channel: 'email',
    validate: vi.fn(),
    prepare: vi.fn(),
    send: vi.fn(send) as Provider['send'],
    mapEvents: vi.fn(() => []) as Provider['mapEvents'],
  }
}

const prepared: PreparedMessage = {
  channel: 'email',
  data: { to: ['rcpt@example.com'], from: 'sender@example.com', subject: 'Hi' },
}

describe('FailoverEmailProvider', () => {
  it('requires at least one provider', () => {
    expect(() => new FailoverEmailProvider({ providers: [] })).toThrow('at least one provider')
  })

  it('returns the primary response when it succeeds and tags providerUsed', async () => {
    const primary = makeProvider('primary', async () => ({ success: true, externalId: 'p-1' }))
    const fallback = makeProvider('fallback', async () => ({ success: true, externalId: 'f-1' }))

    const fp = new FailoverEmailProvider({ providers: [primary, fallback] })
    const res = await fp.send(prepared)

    expect(res.success).toBe(true)
    expect(res.externalId).toBe('p-1')
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
    const res = await fp.send(prepared)

    expect(res.success).toBe(true)
    expect(res.externalId).toBe('f-1')
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
    const res = await fp.send(prepared)

    expect(res.success).toBe(false)
    expect(res.error?.code).toBe('validation_error')
    expect(fallback.send).not.toHaveBeenCalled()
  })

  it('returns FAILOVER_EXHAUSTED when every provider fails transiently', async () => {
    const a = makeProvider('a', async () => ({ success: false, error: { code: 'A_FAIL', message: 'a' } }))
    const b = makeProvider('b', async () => ({ success: false, error: { code: 'B_FAIL', message: 'b' } }))

    const fp = new FailoverEmailProvider({ providers: [a, b] })
    const res = await fp.send(prepared)

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
    const res = await fp.send(prepared)

    expect(res.success).toBe(true)
    expect(res.data?.providerUsed).toBe('fallback')
  })

  it('mapEvents uses providerUsed from response data', () => {
    const primary = makeProvider('primary', async () => ({ success: true }))
    const fallback = makeProvider('fallback', async () => ({ success: true }))
    const fp = new FailoverEmailProvider({ providers: [primary, fallback] })

    const events = fp.mapEvents({ success: true, externalId: 'x', data: { providerUsed: 'fallback' } }, 'msg-1')
    expect(events[0].provider).toBe('fallback')
    expect(events[0].type).toBe('attempt.succeeded')
  })

  it('delegates validate and prepare to the primary', () => {
    const primary = makeProvider('primary', async () => ({ success: true }))
    const fallback = makeProvider('fallback', async () => ({ success: true }))
    const fp = new FailoverEmailProvider({ providers: [primary, fallback] })

    const envelope = {
      idempotencyKey: 'k',
      sender: { email: 's@e.com' },
      recipient: { email: 'r@e.com' },
      channels: ['email' as const],
      payload: { text: 'x' },
    }
    fp.validate(envelope)
    fp.prepare(envelope)
    expect(primary.validate).toHaveBeenCalledOnce()
    expect(primary.prepare).toHaveBeenCalledOnce()
    expect(fallback.validate).not.toHaveBeenCalled()
    expect(fallback.prepare).not.toHaveBeenCalled()
  })
})

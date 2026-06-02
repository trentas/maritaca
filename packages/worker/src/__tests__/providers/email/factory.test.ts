import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(function () { return { emails: { send: vi.fn() } } }) }))
vi.mock('@mailchimp/mailchimp_transactional', () => ({
  default: vi.fn(() => ({ messages: { send: vi.fn() }, users: { ping: vi.fn() } })),
}))
vi.mock('@aws-sdk/client-ses', () => ({
  default: {
    SESClient: vi.fn(function () { return { send: vi.fn() } }),
    SendEmailCommand: vi.fn(),
    GetAccountSendingEnabledCommand: vi.fn(),
  },
}))

import { createEmailProvider } from '../../../providers/email/index.js'
import { FailoverEmailProvider } from '../../../providers/email/failover.js'
import { ResendProvider } from '../../../providers/email/resend.js'
import { MandrillProvider } from '../../../providers/email/mandrill.js'
import { MockEmailProvider } from '../../../providers/email/mock.js'

describe('createEmailProvider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, RESEND_API_KEY: 're_test', MANDRILL_API_KEY: 'md_test' }
    delete process.env.EMAIL_PROVIDER
    delete process.env.EMAIL_PROVIDERS
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns the explicitly requested provider regardless of env', () => {
    process.env.EMAIL_PROVIDER = 'mandrill'
    process.env.EMAIL_PROVIDERS = 'resend,mandrill'
    const provider = createEmailProvider('resend')
    expect(provider).toBeInstanceOf(ResendProvider)
  })

  it('returns a FailoverEmailProvider when EMAIL_PROVIDERS chain has >1 entry', () => {
    process.env.EMAIL_PROVIDERS = 'resend,mandrill'
    const provider = createEmailProvider()
    expect(provider).toBeInstanceOf(FailoverEmailProvider)
    expect(provider.name).toBe('failover(resend,mandrill)')
  })

  it('returns a single provider when EMAIL_PROVIDERS chain has 1 entry', () => {
    process.env.EMAIL_PROVIDERS = 'mandrill'
    const provider = createEmailProvider()
    expect(provider).toBeInstanceOf(MandrillProvider)
  })

  it('ignores unknown entries in the chain', () => {
    process.env.EMAIL_PROVIDERS = 'resend,nonsense,mandrill'
    const provider = createEmailProvider()
    expect(provider).toBeInstanceOf(FailoverEmailProvider)
    expect(provider.name).toBe('failover(resend,mandrill)')
  })

  it('falls back to EMAIL_PROVIDER when EMAIL_PROVIDERS is unset', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    expect(createEmailProvider()).toBeInstanceOf(ResendProvider)
  })

  it('falls back to mock when nothing is configured', () => {
    expect(createEmailProvider()).toBeInstanceOf(MockEmailProvider)
  })

  describe('chain resilience against misconfigured providers', () => {
    it('skips a chain entry that fails to construct and keeps the rest', () => {
      process.env.EMAIL_PROVIDERS = 'resend,mandrill'
      delete process.env.MANDRILL_API_KEY // Make mandrill fail
      const provider = createEmailProvider()
      expect(provider).toBeInstanceOf(ResendProvider)
    })

    it('falls back to mock when every provider in the chain fails to construct', () => {
      process.env.EMAIL_PROVIDERS = 'resend,mandrill'
      delete process.env.RESEND_API_KEY
      delete process.env.MANDRILL_API_KEY
      const provider = createEmailProvider()
      expect(provider).toBeInstanceOf(MockEmailProvider)
    })

    it('keeps the failover wrapper when at least two providers are usable', () => {
      process.env.EMAIL_PROVIDERS = 'resend,mandrill,mock'
      delete process.env.RESEND_API_KEY // Resend fails, the other two should still build
      const provider = createEmailProvider()
      expect(provider).toBeInstanceOf(FailoverEmailProvider)
      expect(provider.name).toBe('failover(mandrill,mock-email)')
    })

    it('still throws when the single-provider EMAIL_PROVIDER mode is misconfigured', () => {
      delete process.env.EMAIL_PROVIDERS
      process.env.EMAIL_PROVIDER = 'resend'
      delete process.env.RESEND_API_KEY
      expect(() => createEmailProvider()).toThrow('RESEND_API_KEY is required')
    })
  })
})

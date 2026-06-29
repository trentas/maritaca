import { describe, it, expect } from 'vitest'
import {
  SLACK_OAUTH_SCOPES,
  SLACK_OAUTH_SCOPE_STRING,
  parseScopes,
  missingScopes,
} from '../../../routes/integrations/slackScopes.js'

describe('SLACK_OAUTH_SCOPE_STRING', () => {
  it('includes the channel resolve/join scopes', () => {
    expect(SLACK_OAUTH_SCOPE_STRING).toContain('channels:read')
    expect(SLACK_OAUTH_SCOPE_STRING).toContain('groups:read')
    expect(SLACK_OAUTH_SCOPE_STRING).toContain('channels:join')
    expect(SLACK_OAUTH_SCOPE_STRING.split(',')).toEqual([...SLACK_OAUTH_SCOPES])
  })
})

describe('parseScopes', () => {
  it('splits, trims and drops empties', () => {
    expect(parseScopes('chat:write, users:read ,')).toEqual(['chat:write', 'users:read'])
  })

  it('returns [] for null/undefined/empty', () => {
    expect(parseScopes(undefined)).toEqual([])
    expect(parseScopes(null)).toEqual([])
    expect(parseScopes('')).toEqual([])
  })
})

describe('missingScopes', () => {
  it('returns [] when all required scopes are granted', () => {
    expect(missingScopes(SLACK_OAUTH_SCOPE_STRING)).toEqual([])
  })

  it('flags the new scopes for a pre-channel-feature install', () => {
    const old = 'chat:write,chat:write.customize,users:read,users:read.email'
    expect(missingScopes(old)).toEqual(['channels:read', 'groups:read', 'channels:join'])
  })

  it('returns all scopes when nothing is granted', () => {
    expect(missingScopes(undefined)).toEqual([...SLACK_OAUTH_SCOPES])
  })
})

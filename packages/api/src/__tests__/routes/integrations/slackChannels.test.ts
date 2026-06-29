import { describe, it, expect, vi } from 'vitest'
import {
  resolveChannelByName,
  joinChannel,
  mapSlackError,
  SlackChannelError,
} from '../../../routes/integrations/slackChannels.js'

/** Build a fake @slack/web-api WebClient with controllable conversations methods. */
function fakeClient(conversations: { list?: any; join?: any }): any {
  return { conversations }
}

/** A thrown Slack WebAPI error carries the code under `.data.error`. */
function slackThrow(error: string): any {
  return Object.assign(new Error(`Slack: ${error}`), { data: { ok: false, error } })
}

describe('resolveChannelByName', () => {
  it('resolves a public channel and reports membership', async () => {
    const client = fakeClient({
      list: vi.fn().mockResolvedValue({
        ok: true,
        channels: [
          { id: 'C111', name: 'general', is_private: false, is_member: true },
          { id: 'C222', name: 'random', is_private: false, is_member: false },
        ],
      }),
    })

    const result = await resolveChannelByName(client, 'random')
    expect(result).toEqual({ channelId: 'C222', channelName: 'random', isPrivate: false, isMember: false })
  })

  it('reports private channels the bot belongs to', async () => {
    const client = fakeClient({
      list: vi.fn().mockResolvedValue({
        ok: true,
        channels: [{ id: 'G999', name: 'secret-team', is_private: true, is_member: true }],
      }),
    })

    const result = await resolveChannelByName(client, 'secret-team')
    expect(result).toMatchObject({ channelId: 'G999', isPrivate: true, isMember: true })
  })

  it('normalizes a leading # and uppercase before matching', async () => {
    const client = fakeClient({
      list: vi.fn().mockResolvedValue({
        ok: true,
        channels: [{ id: 'C111', name: 'alertas-custos', is_private: false, is_member: true }],
      }),
    })

    const result = await resolveChannelByName(client, '#Alertas-Custos')
    expect(result?.channelId).toBe('C111')
  })

  it('paginates through cursors and returns null when not found', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, channels: [{ id: 'C1', name: 'a' }], response_metadata: { next_cursor: 'CUR2' } })
      .mockResolvedValueOnce({ ok: true, channels: [{ id: 'C2', name: 'b' }], response_metadata: { next_cursor: '' } })
    const client = fakeClient({ list })

    const result = await resolveChannelByName(client, 'does-not-exist')
    expect(result).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
    expect(list.mock.calls[1][0]).toMatchObject({ cursor: 'CUR2' })
  })

  it('rejects an empty channel name with 400', async () => {
    const client = fakeClient({ list: vi.fn() })
    await expect(resolveChannelByName(client, '   ')).rejects.toMatchObject({ status: 400, code: 'invalid_channel_name' })
  })

  it('maps a missing_scope failure to 403', async () => {
    const client = fakeClient({ list: vi.fn().mockRejectedValue(slackThrow('missing_scope')) })
    await expect(resolveChannelByName(client, 'general')).rejects.toMatchObject({ status: 403, code: 'missing_scope' })
  })
})

describe('joinChannel', () => {
  it('joins a public channel', async () => {
    const join = vi.fn().mockResolvedValue({ ok: true, channel: { id: 'C111', name: 'general' } })
    const result = await joinChannel(fakeClient({ join }), 'C111')
    expect(result).toEqual({ channelId: 'C111', channelName: 'general', joined: true, alreadyMember: false })
    expect(join).toHaveBeenCalledWith({ channel: 'C111' })
  })

  it('reports alreadyMember when the bot was already in the channel', async () => {
    const join = vi.fn().mockResolvedValue({ ok: true, already_in_channel: true, channel: { id: 'C111', name: 'general' } })
    const result = await joinChannel(fakeClient({ join }), 'C111')
    expect(result.alreadyMember).toBe(true)
    expect(result.joined).toBe(true)
  })

  it('rejects a private channel with 403', async () => {
    const join = vi.fn().mockRejectedValue(slackThrow('method_not_supported_for_channel_type'))
    await expect(joinChannel(fakeClient({ join }), 'C111')).rejects.toMatchObject({ status: 403, code: 'channel_is_private' })
  })

  it('maps channel_not_found to 404', async () => {
    const join = vi.fn().mockRejectedValue(slackThrow('channel_not_found'))
    await expect(joinChannel(fakeClient({ join }), 'CXXX')).rejects.toMatchObject({ status: 404, code: 'channel_not_found' })
  })
})

describe('mapSlackError', () => {
  it('defaults not_in_channel to 404 but honors an override status', () => {
    expect(mapSlackError(slackThrow('not_in_channel')).status).toBe(404)
    expect(mapSlackError(slackThrow('not_in_channel'), 403).status).toBe(403)
  })

  it('maps known Slack errors to stable statuses', () => {
    expect(mapSlackError(slackThrow('channel_not_found')).status).toBe(404)
    expect(mapSlackError(slackThrow('is_archived')).status).toBe(409)
    expect(mapSlackError(slackThrow('invalid_auth')).status).toBe(502)
    expect(mapSlackError(slackThrow('ratelimited')).status).toBe(429)
  })

  it('falls back to 502 for unknown errors', () => {
    const mapped = mapSlackError(slackThrow('some_new_error'))
    expect(mapped.status).toBe(502)
    expect(mapped.code).toBe('slack_api_error')
  })

  it('passes through an existing SlackChannelError unchanged', () => {
    const original = new SlackChannelError(400, 'invalid_channel_name', 'bad')
    expect(mapSlackError(original)).toBe(original)
  })
})

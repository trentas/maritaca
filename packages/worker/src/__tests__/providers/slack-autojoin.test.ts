import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the Slack WebClient so we can drive postMessage / conversations.join.
const { postMessage, join } = vi.hoisted(() => ({ postMessage: vi.fn(), join: vi.fn() }))

vi.mock('@slack/web-api', () => ({
  // Regular function (not arrow) so it can be invoked with `new`.
  WebClient: vi.fn(function (this: any) {
    this.chat = { postMessage }
    this.conversations = { join }
  }),
}))

import { SlackProvider } from '../../providers/slack.js'

function notInChannel(): any {
  return Object.assign(new Error('not_in_channel'), { data: { ok: false, error: 'not_in_channel' } })
}

function preparedFor(target: { directTargets?: string[]; channelNames?: string[] }) {
  return {
    channel: 'slack' as const,
    data: {
      botToken: '',
      recipientInfo: { directTargets: target.directTargets ?? [], channelNames: target.channelNames ?? [], emails: [] },
      text: 'hello',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hello' } }],
    },
  }
}

const creds = { credentials: { botToken: 'xoxb-test' }, messageId: 'm1' }

describe('SlackProvider transparent auto-join', () => {
  let provider: SlackProvider

  beforeEach(() => {
    provider = new SlackProvider()
    postMessage.mockReset()
    join.mockReset()
  })

  it('joins a public channel on not_in_channel and retries the send', async () => {
    postMessage.mockRejectedValueOnce(notInChannel()).mockResolvedValueOnce({ ok: true, ts: '1700000000.000100' })
    join.mockResolvedValue({ ok: true })

    const result = await provider.send(preparedFor({ directTargets: ['C08ABC'] }), creds)

    expect(result.success).toBe(true)
    expect(join).toHaveBeenCalledWith({ channel: 'C08ABC' })
    expect(postMessage).toHaveBeenCalledTimes(2)
  })

  it('surfaces the original error when join fails (private channel)', async () => {
    postMessage.mockRejectedValue(notInChannel())
    join.mockRejectedValue(Object.assign(new Error('private'), { data: { error: 'method_not_supported_for_channel_type' } }))

    const result = await provider.send(preparedFor({ directTargets: ['C08PRIV'] }), creds)

    expect(result.success).toBe(false)
    expect(join).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('does not attempt to join when the target is a channel name, not an ID', async () => {
    postMessage.mockRejectedValue(notInChannel())

    const result = await provider.send(preparedFor({ channelNames: ['general'] }), creds)

    expect(result.success).toBe(false)
    expect(join).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledTimes(1)
  })
})

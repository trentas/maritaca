import type { WebClient } from '@slack/web-api'

/**
 * Result of resolving a Slack channel name to its canonical ID.
 */
export interface ResolvedChannel {
  channelId: string
  channelName: string
  isPrivate: boolean
  isMember: boolean
}

/**
 * Result of attempting to join a Slack channel.
 */
export interface JoinResult {
  channelId: string
  channelName?: string
  /** true if the bot is now a member (joined just now or was already in) */
  joined: boolean
  /** true if the bot was already a member before this call */
  alreadyMember: boolean
}

/**
 * Typed error carrying the HTTP status the route should return plus the raw
 * Slack error code (when the failure originated from the Slack API).
 */
export class SlackChannelError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly slackError?: string

  constructor(status: number, code: string, message: string, slackError?: string) {
    super(message)
    this.name = 'SlackChannelError'
    this.status = status
    this.code = code
    this.slackError = slackError
  }
}

/**
 * Extract the Slack error string from either a thrown WebAPI error
 * (`err.data.error`) or a non-throwing `{ ok: false, error }` response.
 */
function slackErrorOf(err: any): string | undefined {
  return err?.data?.error ?? err?.error
}

/**
 * Map a Slack API failure to a SlackChannelError with an appropriate HTTP status.
 * `notInChannelStatus` lets callers choose how `not_in_channel` is surfaced
 * (404 during resolve — channel is effectively invisible; 403 during join).
 */
export function mapSlackError(err: any, notInChannelStatus = 404): SlackChannelError {
  if (err instanceof SlackChannelError) return err
  const slackError = slackErrorOf(err)

  switch (slackError) {
    case 'channel_not_found':
      return new SlackChannelError(404, 'channel_not_found', 'Channel not found', slackError)
    case 'not_in_channel':
      return new SlackChannelError(notInChannelStatus, 'not_in_channel', 'Bot is not a member of the channel', slackError)
    case 'method_not_supported_for_channel_type':
      return new SlackChannelError(403, 'channel_is_private', 'Channel is private; the bot must be invited manually with /invite', slackError)
    case 'is_archived':
      return new SlackChannelError(409, 'channel_is_archived', 'Channel is archived', slackError)
    case 'missing_scope':
    case 'not_allowed_token_type':
      return new SlackChannelError(
        403,
        'missing_scope',
        'The Slack token is missing a required scope (channels:read, groups:read or channels:join); reconnect the integration',
        slackError,
      )
    case 'invalid_auth':
    case 'token_revoked':
    case 'account_inactive':
      return new SlackChannelError(502, 'slack_auth_failed', 'Slack rejected the stored token; reconnect the integration', slackError)
    case 'ratelimited':
      return new SlackChannelError(429, 'slack_rate_limited', 'Rate limited by Slack; retry later', slackError)
    default:
      return new SlackChannelError(502, 'slack_api_error', `Slack API error${slackError ? `: ${slackError}` : ''}`, slackError)
  }
}

/** Strip a leading '#' and lowercase — Slack channel names are always lowercase. */
function normalizeName(channelName: string): string {
  return channelName.replace(/^#/, '').trim().toLowerCase()
}

/**
 * Resolve a Slack channel name to its canonical ID by paging through
 * `conversations.list`. Returns null when no channel matches.
 *
 * Note: `conversations.list` only returns public channels (member or not) and
 * private channels the bot already belongs to. A private channel the bot is not
 * in is indistinguishable from a non-existent one and surfaces as `null` (404).
 *
 * @throws {SlackChannelError} when the Slack API itself fails (e.g. missing_scope).
 */
export async function resolveChannelByName(
  client: WebClient,
  channelName: string,
): Promise<ResolvedChannel | null> {
  const target = normalizeName(channelName)
  if (!target) {
    throw new SlackChannelError(400, 'invalid_channel_name', 'channelName must not be empty')
  }

  let cursor: string | undefined
  try {
    do {
      const res = await client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 1000,
        cursor,
      })

      const match = res.channels?.find((c) => c.name === target)
      if (match?.id) {
        return {
          channelId: match.id,
          channelName: match.name ?? target,
          isPrivate: Boolean(match.is_private),
          isMember: Boolean(match.is_member),
        }
      }

      cursor = res.response_metadata?.next_cursor || undefined
    } while (cursor)
  } catch (err) {
    throw mapSlackError(err)
  }

  return null
}

/**
 * Join a Slack channel by ID. `conversations.join` is idempotent — joining a
 * channel the bot is already in succeeds. Public channels only; private
 * channels reject with `method_not_supported_for_channel_type` (→ 403).
 *
 * @throws {SlackChannelError} on any Slack failure (not found, private, scope…).
 */
export async function joinChannel(client: WebClient, channelId: string): Promise<JoinResult> {
  try {
    const res = await client.conversations.join({ channel: channelId })
    if (res.ok === false) {
      throw mapSlackError(res, 403)
    }
    // Slack returns a warning + already_in_channel response metadata when the
    // bot was already a member; treat a missing flag as a fresh join.
    const alreadyMember = Boolean((res as any).already_in_channel)
    return {
      channelId,
      channelName: res.channel?.name,
      joined: true,
      alreadyMember,
    }
  } catch (err) {
    throw mapSlackError(err, 403)
  }
}

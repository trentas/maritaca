/**
 * The OAuth bot scopes Maritaca requests for full Slack functionality.
 * Single source of truth — used both to build the `/authorize` request and to
 * detect whether an already-installed integration is missing any scope (and
 * therefore needs the tenant to re-consent).
 */
export const SLACK_OAUTH_SCOPES = [
  'chat:write',
  'chat:write.customize',
  'users:read',
  'users:read.email',
  'channels:read',
  'groups:read',
  'channels:join',
] as const

/** Comma-separated scope string for the Slack `/oauth/v2/authorize` request. */
export const SLACK_OAUTH_SCOPE_STRING = SLACK_OAUTH_SCOPES.join(',')

/** Parse a Slack-granted scope string into a normalized set. */
export function parseScopes(granted: string | undefined | null): string[] {
  return (granted ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Of the scopes Maritaca currently requests, return those NOT present in the
 * token's granted scopes. A non-empty result means the integration was
 * installed before those scopes existed and the tenant must re-run OAuth.
 */
export function missingScopes(granted: string | undefined | null): string[] {
  const grantedSet = new Set(parseScopes(granted))
  return SLACK_OAUTH_SCOPES.filter((s) => !grantedSet.has(s))
}

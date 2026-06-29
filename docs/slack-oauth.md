# Slack OAuth Integration (Multi-Tenant)

Maritaca supports per-project Slack integrations via OAuth. Each project can connect its own Slack workspace — the platform handles the OAuth flow, encrypts and stores the bot token, and uses it automatically when sending messages.

> **One project per tenant.** A Slack integration is scoped per `projectId`
> (`UNIQUE(project_id, channel, provider)` → exactly one active Slack workspace
> per project). If you are a **multi-tenant consumer** (a SaaS whose own
> customers each need their own Slack workspace), authenticating all of them
> with a single Maritaca API key collapses them into one project — the next
> tenant's OAuth **overwrites** the previous workspace token. The
> architecturally-aligned fix is **one Maritaca project / API key per downstream
> tenant**: provision a key per tenant via `pnpm create-api-key <key> <tenant-id>`
> or, at runtime, the admin API (`POST /v1/admin/api-keys` — see the
> [README](../README.md#admin-api--provisioning-api-keys) and
> [API spec](./MARITACA_API_SPEC.md#admin-api)), then run this OAuth flow with
> each tenant's own key so every tenant gets an isolated Slack integration.

## Prerequisites

- A running Maritaca instance (API + Worker + Postgres)
- A valid API key for the project you want to connect

## 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **"Create New App"** → **"From scratch"**
3. Name it (e.g. "Maritaca Notifications") and pick a development workspace
4. Click **"Create App"**

## 2. Configure OAuth in the Slack App

In the Slack App dashboard, go to **OAuth & Permissions**:

1. **Redirect URLs** — add your Maritaca callback URL:
   ```
   https://your-domain.com/v1/integrations/slack/callback
   ```
   For local development, see [Local development with ngrok](#local-development-with-ngrok) below.

2. **Bot Token Scopes** — add at minimum:
   - `chat:write` — send messages
   - `chat:write.customize` — customize bot name and icon per message
   - `users:read` — required by `users:read.email`
   - `users:read.email` — resolve users by email
   - `channels:read` — list/look up public channels (channel name → ID resolution)
   - `groups:read` — same for private channels the bot belongs to
   - `channels:join` — let the bot join public channels (auto-join + join endpoint)

   > **Re-consent required.** These last three scopes were added after the
   > initial release. Workspaces installed before then must re-run the OAuth
   > flow (`GET /authorize`) to grant them; otherwise channel resolve/join calls
   > fail with `missing_scope`.

### Local development with ngrok

Slack requires HTTPS for redirect URLs, so `http://localhost` won't work. Use [ngrok](https://ngrok.com) to create an HTTPS tunnel:

```bash
# Install
brew install ngrok

# Start a tunnel to the Maritaca API port
ngrok http 7377
```

ngrok outputs a public URL like:

```
https://abc123.ngrok-free.app -> http://localhost:7377
```

Use it as the redirect URL in the Slack App:

```
https://abc123.ngrok-free.app/v1/integrations/slack/callback
```

> **Note:** The free ngrok URL changes every time you restart it. Update the Slack redirect URL accordingly, or use a paid plan for a stable subdomain.

## 3. Collect Credentials

From the Slack App dashboard → **Basic Information** → "App Credentials":

| Variable | Source |
|----------|--------|
| `SLACK_CLIENT_ID` | Client ID |
| `SLACK_CLIENT_SECRET` | Client Secret |
| `SLACK_SIGNING_SECRET` | Signing Secret |

Generate the encryption key yourself:

```bash
openssl rand -hex 32
```

## 4. Set Environment Variables

Add to your `.env`:

```bash
# Slack App OAuth (multi-tenant)
SLACK_CLIENT_ID=1234567890.1234567890
SLACK_CLIENT_SECRET=abcdef1234567890abcdef
SLACK_SIGNING_SECRET=abcdef1234567890abcdef

# Encryption key for stored integration credentials (32+ hex chars)
INTEGRATION_ENCRYPTION_KEY=<output from openssl rand above>

# (Optional) Global fallback token — used when a project has no OAuth integration
SLACK_BOT_TOKEN=xoxb-fallback-token
```

Restart the API and Worker services after updating.

## 5. Test the OAuth Flow

### Step 1 — Start authorization

```bash
curl -v \
  "http://localhost:7377/v1/integrations/slack/authorize?redirectUri=http://localhost:3000/callback" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

This returns a `302` redirect to Slack. Copy the `Location` header URL and open it in a browser.

### Step 2 — Authorize in Slack

Click **"Allow"** in the Slack consent screen. Slack redirects back to:

```
http://localhost:7377/v1/integrations/slack/callback?code=xxx&state=yyy
```

Maritaca exchanges the code for a bot token, encrypts it, and stores it. Then it redirects to your `redirectUri`:

```
http://localhost:3000/callback?status=success&team=YourTeamName
```

On failure:

```
http://localhost:3000/callback?status=error&error=<message>
```

### Step 3 — Check integration status

```bash
curl "http://localhost:7377/v1/integrations/slack/status" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Response:

```json
{
  "active": true,
  "teamName": "Your Workspace",
  "teamId": "T12345678",
  "installedAt": "2025-01-15T10:30:00.000Z",
  "scopes": ["chat:write", "chat:write.customize", "users:read", "users:read.email"],
  "missingScopes": ["channels:read", "groups:read", "channels:join"],
  "needsReauth": true
}
```

| Field | Meaning |
|-------|---------|
| `scopes` | Bot scopes Slack granted to the stored token |
| `missingScopes` | Scopes Maritaca now requests that this token lacks |
| `needsReauth` | `true` when `missingScopes` is non-empty — re-run `/authorize` to grant them |

> **Detecting re-consent.** Integrations installed before the channel
> resolve/join scopes were added report `needsReauth: true`. Use this to show a
> "reconnect Slack" prompt and send the tenant back through `GET /authorize`
> (the new token overwrites the old one, keeping the same `projectId`). Channel
> resolve/join calls fail with `missing_scope` until then.

### Step 4 — Send a message

```bash
curl -X POST "http://localhost:7377/v1/messages" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "slack-test-1",
    "channels": ["slack"],
    "sender": { "name": "Maritaca" },
    "recipient": {
      "slack": { "channelName": "#general" }
    },
    "payload": {
      "title": "Hello",
      "text": "Hello from Maritaca!"
    }
  }'
```

The worker automatically uses the project's OAuth token. If no integration exists, it falls back to the global `SLACK_BOT_TOKEN`.

#### Customizing the bot appearance

You can override the bot's display name and icon per message using `overrides.slack`:

```bash
curl -X POST "http://localhost:7377/v1/messages" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "slack-custom-icon",
    "channels": ["slack"],
    "sender": { "name": "Maritaca" },
    "recipient": {
      "slack": { "channelName": "#general" }
    },
    "payload": {
      "text": "Custom bot appearance!"
    },
    "overrides": {
      "slack": {
        "username": "Deploy Bot",
        "iconEmoji": ":rocket:"
      }
    }
  }'
```

Available overrides:

| Field | Description | Example |
|-------|-------------|---------|
| `username` | Override bot display name | `"Deploy Bot"` |
| `iconEmoji` | Override icon with a Slack emoji | `":rocket:"` |
| `iconUrl` | Override icon with an image URL | `"https://example.com/icon.png"` |
| `blocks` | Custom Slack Block Kit blocks | `[{"type": "section", ...}]` |

> **Note:** `iconEmoji` and `iconUrl` are mutually exclusive — if both are set, Slack uses `iconEmoji`.

### Resolving and joining channels (recommended setup flow)

Delivering by `channelName` is fragile: Slack name matching is case-sensitive,
renaming the channel silently breaks delivery, and a bot that was never invited
to a channel produces a `201 Accepted` whose message never arrives (the failure
only surfaces later as an `attempt.failed` event). Two endpoints make channel
setup explicit and rename-proof.

#### Resolve a channel name to its ID

```bash
curl -X POST "http://localhost:7377/v1/integrations/slack/channels/resolve" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "channelName": "alertas-custos-datadog" }'
```

```json
{
  "channelId": "C08XXXXXXXX",
  "channelName": "alertas-custos-datadog",
  "isPrivate": false,
  "isMember": true
}
```

| Status | Meaning |
|--------|---------|
| `200` | Resolved — persist `channelId` and deliver by ID from now on |
| `404` | Channel not found (or a private channel the bot isn't in) |
| `403` | `missing_scope` — re-run OAuth to grant `channels:read` / `groups:read` |
| `400` | Missing `channelName`, or the project has no Slack integration |

#### Join a public channel

```bash
curl -X POST "http://localhost:7377/v1/integrations/slack/channels/C08XXXXXXXX/join" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

```json
{ "channelId": "C08XXXXXXXX", "channelName": "alertas-custos-datadog", "joined": true, "alreadyMember": false }
```

| Status | Meaning |
|--------|---------|
| `200` | Bot joined (idempotent — also `200` if already a member) |
| `403` | Channel is private — invite the bot manually with `/invite` |
| `404` | Channel not found |

> **Recommended flow:** at channel-configuration time, call **resolve** to get
> the immutable `C…` ID, then **join** (for public channels) so the bot is a
> member, persist the `channelId`, and always deliver by `channelId`. This is
> immune to channel renames and avoids the silent "accepted but never delivered"
> failure.

> **Transparent auto-join.** Independently of the join endpoint, when a message
> targets a **public channel by ID** and the bot isn't a member, the worker
> automatically calls `conversations.join` once and retries the send. Private
> channels can't be auto-joined and still require a manual `/invite`.

#### SDK

```typescript
const { channelId } = await maritaca.slack.resolveChannel('alertas-custos-datadog')
await maritaca.slack.joinChannel(channelId) // public channels
```

### Step 5 — Revoke integration

```bash
curl -X DELETE "http://localhost:7377/v1/integrations/slack" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## How It Works

```
Your App            Maritaca API               Slack
  |                     |                        |
  |-- GET /authorize -->|                        |
  |                     |-- 302 redirect ------->|
  |                     |                        |
  |                     |<-- callback (code) ----|
  |                     |-- exchange code ------->|
  |                     |<-- bot token ----------|
  |                     |-- encrypt & store      |
  |<-- redirect --------|                        |
  |   ?status=success   |                        |
  |                     |                        |
  |-- POST /messages -->|                        |
  |                     |-- load credentials     |
  |                     |-- decrypt token        |
  |                     |-- worker sends ------->|
```

## Token Priority

When sending a Slack message, the worker resolves the bot token in this order:

1. **Per-project OAuth token** — stored encrypted in the `integrations` table
2. **Global `SLACK_BOT_TOKEN`** — environment variable fallback

This ensures backward compatibility: projects without OAuth use the global token.

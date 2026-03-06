# Slack OAuth Integration (Multi-Tenant)

Maritaca supports per-project Slack integrations via OAuth. Each project can connect its own Slack workspace — the platform handles the OAuth flow, encrypts and stores the bot token, and uses it automatically when sending messages.

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
   - `users:read.email` — resolve users by email

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
  "installedAt": "2025-01-15T10:30:00.000Z"
}
```

### Step 4 — Send a message

```bash
curl -X POST "http://localhost:7377/v1/messages" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "channels": ["slack"],
    "recipients": [{"slackUserId": "U12345678"}],
    "content": {"subject": "Test", "body": "Hello from Maritaca!"}
  }'
```

The worker automatically uses the project's OAuth token. If no integration exists, it falls back to the global `SLACK_BOT_TOKEN`.

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

# Maritaca API Specification

Reference document for integrating applications with Maritaca as a messaging client.

## Overview

- **Base URL**: configurable (e.g. `http://localhost:7377` or your deployment URL)
- **Prefix**: `/v1` for all message endpoints
- **Content-Type**: `application/json`
- **Authentication**: Bearer token (API key)

## Authentication

All requests to `/v1/*` endpoints must send the header:

```
Authorization: Bearer <API_KEY>
```

- The API key is tied to a project in Maritaca.
- Missing or invalid header returns `401 Unauthorized`.
- Authentication error responses:
  - `Missing or invalid Authorization header`
  - `API key is required`
  - `Invalid API key`

## Endpoints

### POST /v1/messages

Creates and enqueues a message for delivery on one or more channels.

**Headers**

| Header             | Required | Description                    |
|--------------------|----------|-------------------------------|
| `Authorization`    | Yes      | `Bearer <API_KEY>`            |
| `Content-Type`     | Yes      | `application/json`            |

**Body (envelope)**

JSON object validated by the core schema (Zod). Main fields:

| Field             | Type                    | Required | Description |
|-------------------|-------------------------|----------|-------------|
| `idempotencyKey`  | string (min 1)          | Yes      | Idempotency key (per project). |
| `sender`          | object                  | Yes      | Sender (name, email). |
| `recipient`       | object \| object[]      | Yes      | Single recipient or array of recipients. |
| `channels`        | string[]                | Yes      | One or more of: `email`, `slack`, `push`, `web`, `sms`, `whatsapp`, `telegram`. |
| `payload`         | object                  | Yes      | Content: `text` (required), `title`, `html` optional. |
| `metadata`        | object                  | No       | Optional metadata. |
| `overrides`       | object                  | No       | Per-channel overrides. |
| `scheduleAt`      | string (ISO 8601)       | No       | Scheduled send time. |
| `priority`        | string                  | No       | `low`, `normal`, `high`. |

**Sender**

```json
{
  "name": "string (optional)",
  "email": "string email (optional)"
}
```

**Recipient** (depends on channel; at least one identifier per channel used)

- **Email**: `recipient.email` (string, email).
- **Slack**: `recipient.slack` — at least one of: `userId`, `channelId`, `channelName`, `email`.
- **SMS**: `recipient.sms.phoneNumber` (E.164, e.g. `+5511999999999`).
- **WhatsApp**: `recipient.whatsapp.phoneNumber` (E.164).
- **Telegram**: `recipient.telegram.chatId` (string or number); `username` optional.
- **Push (mobile)**: `recipient.push` — either `endpointArn` or `deviceToken` + `platform` (`APNS`, `APNS_SANDBOX`, `GCM`).
- **Web Push**: `recipient.web` — `endpoint` (URL), `keys.p256dh`, `keys.auth`; `expirationTime` optional.

**Payload**

```json
{
  "title": "string (optional)",
  "text": "string (required)",
  "html": "string (optional)"
}
```

**Channel overrides** (all optional)

- **email**: `subject`, `provider` (`resend` \| `ses` \| `mock`).
- **slack**: `blocks` (array).
- **sms**: `provider` (`sns` \| `twilio`), `messageType` (`Transactional` \| `Promotional`), `senderId` (max 11 characters).
- **whatsapp**: `contentSid`, `contentVariables`, `mediaUrl`.
- **push**: `badge`, `sound`, `data`, `ttl`.
- **web**: `icon`, `badge`, `image`, `tag`, `renotify`, `requireInteraction`, `vibrate`, `actions`, `data`, `ttl`, `urgency` (`very-low` \| `low` \| `normal` \| `high`).
- **telegram**: `parseMode` (`HTML` \| `MarkdownV2`), `disableNotification`, `replyToMessageId`.

**Success response**: `201 Created`

```json
{
  "messageId": "string (CUID2)",
  "status": "string (e.g. pending)",
  "channels": ["string"]
}
```

**Errors**

- `400`: invalid body — `error: "Validation Error"`, `message: "Invalid envelope format"`, `details` with Zod errors.
- `401`: not authenticated or project not identified.
- `429`: rate limit exceeded (see Rate limiting).
- `500`: internal error — `error: "Internal Server Error"`, `message: "Failed to create message"`.

**Idempotency**: The pair `(projectId, idempotencyKey)` is unique. Resubmitting with the same key returns the same `messageId` and status of the existing record (201 with existing record data).

---

### GET /v1/messages/:id

Returns a message and its events (status and history).

**Headers**

| Header          | Required | Description             |
|-----------------|----------|-------------------------|
| `Authorization` | Yes      | `Bearer <API_KEY>`      |

**Path parameters**

| Name | Type   | Description      |
|------|--------|------------------|
| `id` | string | Message ID (CUID2). |

**Success response**: `200 OK`

```json
{
  "id": "string",
  "status": "string",
  "envelope": { },
  "events": [
    {
      "id": "string",
      "type": "string (e.g. message.accepted, message.queued, message.delivered)",
      "channel": "string (optional)",
      "provider": "string (optional)",
      "payload": "object (optional)",
      "createdAt": "string ISO 8601"
    }
  ]
}
```

**Errors**

- `401`: not authenticated.
- `404`: message not found or belongs to another project — `error: "Not Found"`, `message: "Message not found"`.
- `500`: internal error.

---

### GET /health

Health check (no authentication). Used for readiness/liveness.

**Success response**: `200` when healthy, `503` when degraded.

```json
{
  "status": "ok | degraded",
  "timestamp": "string ISO 8601",
  "checks": {
    "database": { "status": "ok | error", "latencyMs": number, "error": "string (optional)" },
    "redis": { "status": "ok | error", "latencyMs": number, "error": "string (optional)" }
  }
}
```

## Rate limiting

- Applied by `projectId` (authenticated requests) or by IP (when not authenticated).
- Configurable on the server (e.g. 100 requests per minute).
- Response headers: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `retry-after`.
- When exceeded: `429 Too Many Requests`:
  - `error: "Too Many Requests"`
  - `message`: indicates when to retry
  - `retryAfter`: seconds

The `/health` endpoint is not rate limited.

## Supported channels

| Channel        | Value in `channels` array |
|----------------|---------------------------|
| Email          | `email`                   |
| Slack          | `slack`                   |
| SMS            | `sms`                     |
| WhatsApp       | `whatsapp`                |
| Telegram       | `telegram`                |
| Push (mobile)  | `push`                    |
| Web Push       | `web`                     |

## SDK usage (optional)

For Node/TypeScript projects, you can use the `@maritaca/sdk` package:

```ts
import { Maritaca } from '@maritaca/sdk'

const client = new Maritaca({
  apiKey: process.env.MARITACA_API_KEY!,
  baseUrl: 'https://your-maritaca-api.example.com'
})

// Send message
const { messageId, status, channels } = await client.messages.send({
  idempotencyKey: 'uniq-key-123',
  channels: ['email'],
  sender: { name: 'App', email: 'noreply@example.com' },
  recipient: { email: 'user@example.com' },
  payload: { title: 'Hello', text: 'Plain text content' }
})

// Get message
const message = await client.messages.get(messageId)
```

SDK errors: `MaritacaAPIError` (4xx/5xx responses), `MaritacaNetworkError` (network failure), `MaritacaError` (base).

## Minimal example (cURL)

```bash
curl -X POST "${MARITACA_BASE_URL}/v1/messages" \
  -H "Authorization: Bearer ${MARITACA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "minimal-1",
    "channels": ["email"],
    "sender": { "name": "App", "email": "noreply@example.com" },
    "recipient": { "email": "user@example.com" },
    "payload": { "text": "Minimal message" }
  }'
```

---

*Specification derived from the Maritaca repository (Fastify API, core validation, and SDK).*

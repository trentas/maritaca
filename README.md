<p align="center">
  <img src="assets/favicon.svg" alt="Maritaca" width="200">
</p>

# Maritaca

A self-hosted, event-oriented notification API for multi-channel notifications with a focus on developer experience.

Maritaca is to notifications what Resend is to email: simple, predictable, well-typed, easy to debug, and extensible through providers.

## Supported Channels

| Channel | Providers | Use Case |
|---------|-----------|----------|
| **email** | Resend, AWS SES | Transactional emails, marketing |
| **slack** | Slack API | Team notifications, alerts |
| **sms** | AWS SNS, Twilio | OTP codes, urgent alerts |
| **whatsapp** | Twilio | Customer messaging, support |
| **telegram** | Telegram Bot API | Bots, groups, channels |
| **push** | AWS SNS | Mobile apps (iOS/Android) |
| **web** | Web Push | Browser notifications |

## Features

- **Multi-channel**: Email, Slack, SMS, WhatsApp, Push (mobile & web)
- **Event-first architecture**: Every notification generates explicit, queryable events
- **Provider-agnostic**: Swap providers without changing application code
- **GDPR/LGPD compliant**: Audit logs with encrypted PII, data retention policies
- **Self-hosted**: No mandatory external SaaS dependencies
- **Idempotent by design**: Safe retries, no duplicate notifications
- **Observable**: OpenTelemetry traces, metrics, and logs built-in
- **Type-safe**: Full TypeScript support with Zod validation
- **Production-ready**: Health checks, rate limiting, LRU caching

## Architecture

Maritaca is built as a monorepo with 4 packages:

| Package | Description |
|---------|-------------|
| **@maritaca/core** | Types, validation, database schema, audit service |
| **@maritaca/api** | Fastify HTTP API server |
| **@maritaca/worker** | BullMQ workers for notifications and maintenance |
| **@maritaca/sdk** | TypeScript client library |

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│  API Server │────▶│    Redis    │
│  (SDK/HTTP) │     │  (Fastify)  │     │  (BullMQ)   │
└─────────────┘     └─────────────┘     └──────┬──────┘
                           │                   │
                           ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐
                    │  PostgreSQL │◀────│   Worker    │
                    │  (messages) │     │ (providers) │
                    └─────────────┘     └─────────────┘
```

## Quick Start

### Prerequisites

- Node.js 22 LTS
- pnpm 8+
- Docker and Docker Compose
- PostgreSQL 15+
- Redis 7+

### Installation

```bash
# Clone and install
git clone https://github.com/trentas/maritaca.git
cd maritaca
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your settings (see .env.example for all options)

# Start services
docker-compose up -d

# Apply schema to database (from repo root)
pnpm db:push

# Create API key
pnpm create-api-key
```

**Troubleshooting "Failed to create message"**: If the API returns this error, the API server logs the underlying cause. Common causes: PostgreSQL or Redis not running or unreachable. Ensure `docker-compose up -d` is running and `DATABASE_URL` / `REDIS_URL` in `.env` match. Check connectivity with `GET http://localhost:7377/health`; if `database` or `redis` show `"status":"error"`, fix those services first. In development, the API may include a `detail` field in the error response with the underlying error message.

### Send your first notification

```typescript
import { Maritaca } from '@maritaca/sdk'

const maritaca = new Maritaca({
  apiKey: process.env.MARITACA_API_KEY,
  baseUrl: 'http://localhost:7377'
})

// Email
await maritaca.messages.send({
  idempotencyKey: 'welcome-user-456',
  channels: ['email'],
  sender: { name: 'Acme', email: 'hello@acme.com' },
  recipient: { email: 'customer@example.com' },
  payload: {
    title: 'Welcome!',
    text: 'Thanks for signing up.',
    html: '<h1>Welcome!</h1>'
  }
})

// Slack
await maritaca.messages.send({
  idempotencyKey: 'order-confirmed',
  channels: ['slack'],
  sender: { name: 'Order Bot' },
  recipient: { slack: { channelName: 'orders' } },
  payload: { text: 'Order #123 confirmed!' }
})

// SMS
await maritaca.messages.send({
  idempotencyKey: 'otp-789',
  channels: ['sms'],
  sender: { name: 'Acme' },
  recipient: { sms: { phoneNumber: '+5511999999999' } },
  payload: { text: 'Your code is 123456' }
})

// WhatsApp
await maritaca.messages.send({
  idempotencyKey: 'whatsapp-order',
  channels: ['whatsapp'],
  sender: { name: 'Acme' },
  recipient: { whatsapp: { phoneNumber: '+5511999999999' } },
  payload: { title: 'Order Update', text: 'Your order shipped!' },
  overrides: {
    whatsapp: { contentSid: 'HX1234...' } // Template for initiation
  }
})

// Web Push (Browser)
await maritaca.messages.send({
  idempotencyKey: 'web-push-alert',
  channels: ['web'],
  sender: { name: 'Acme' },
  recipient: {
    web: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/...',
      keys: { p256dh: '...', auth: '...' }
    }
  },
  payload: { title: 'New Message', text: 'You have a notification' }
})

// Mobile Push (iOS/Android)
await maritaca.messages.send({
  idempotencyKey: 'mobile-push',
  channels: ['push'],
  sender: { name: 'Acme' },
  recipient: {
    push: { deviceToken: 'abc123...', platform: 'APNS' }
  },
  payload: { title: 'New Order', text: 'Order #456 received' },
  overrides: { push: { badge: 1, sound: 'default' } }
})

// Telegram
await maritaca.messages.send({
  idempotencyKey: 'telegram-alert',
  channels: ['telegram'],
  sender: { name: 'Alert Bot' },
  recipient: { telegram: { chatId: 123456789 } },
  payload: { title: 'Server Alert', text: 'CPU usage above 90%' },
  overrides: { telegram: { parseMode: 'HTML', disableNotification: false } }
})

// Multi-channel (same message, multiple channels)
await maritaca.messages.send({
  idempotencyKey: 'urgent-alert',
  channels: ['email', 'sms', 'slack'],
  sender: { name: 'Alerts', email: 'alerts@acme.com' },
  recipient: {
    email: 'admin@acme.com',
    sms: { phoneNumber: '+5511999999999' },
    slack: { channelName: 'alerts' }
  },
  payload: { title: 'Server Down', text: 'Production is unreachable!' }
})
```

### Using cURL

```bash
# Email
curl -X POST http://localhost:7377/v1/messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "email-123",
    "channels": ["email"],
    "sender": { "name": "Acme", "email": "noreply@acme.com" },
    "recipient": { "email": "user@example.com" },
    "payload": { "title": "Welcome!", "text": "Thanks for joining." }
  }'

# SMS via Twilio
curl -X POST http://localhost:7377/v1/messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "sms-456",
    "channels": ["sms"],
    "sender": { "name": "Acme" },
    "recipient": { "sms": { "phoneNumber": "+5511999999999" } },
    "payload": { "text": "Your code: 123456" },
    "overrides": { "sms": { "provider": "twilio" } }
  }'

# WhatsApp
curl -X POST http://localhost:7377/v1/messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "whatsapp-789",
    "channels": ["whatsapp"],
    "sender": { "name": "Acme" },
    "recipient": { "whatsapp": { "phoneNumber": "+5511999999999" } },
    "payload": { "text": "Your order has shipped!" }
  }'
```

## Providers

### Email

| Provider | Description | Required Config |
|----------|-------------|-----------------|
| **mock** | Logs emails (development) | None |
| **resend** | [Resend](https://resend.com) API | `RESEND_API_KEY` |
| **ses** | AWS Simple Email Service | `AWS_REGION`, AWS credentials |

Set `EMAIL_PROVIDER` environment variable (default: `mock`).

### Slack

Send messages to users or channels with multiple recipient options:

| Recipient Type | Example | Description |
|----------------|---------|-------------|
| `userId` | `U01ABC123` | Direct message to user |
| `channelId` | `C01XYZ789` | Post to channel by ID |
| `channelName` | `general` | Post to channel by name |
| `email` | `user@company.com` | Lookup user by email, send DM |

Features: LRU cache for email lookups, automatic retry with backoff, Slack blocks support.

Required: `SLACK_BOT_TOKEN` with scopes `chat:write`, `users:read.email`

### SMS

| Provider | Description | Required Config |
|----------|-------------|-----------------|
| **sns** | AWS SNS (default) | `AWS_REGION`, AWS credentials |
| **twilio** | Twilio Programmable SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` |

Set `SMS_PROVIDER` or override per-message via `overrides.sms.provider`.

### WhatsApp

Uses Twilio WhatsApp Business API.

| Feature | Description |
|---------|-------------|
| Template messages | Required for initiating conversations (`contentSid`) |
| Session messages | Free-form within 24h window |
| Media attachments | Images, documents via `mediaUrl` |

Required: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`

### Telegram

Send messages via Telegram Bot API using [grammy](https://grammy.dev/):

| Recipient Type | Example | Description |
|----------------|---------|-------------|
| `chatId` (numeric) | `123456789` | User or group chat ID |
| `chatId` (string) | `@channelname` | Public channel username |

Features:
- HTML and MarkdownV2 formatting
- Silent notifications (`disableNotification`)
- Reply to specific messages (`replyToMessageId`)
- Automatic retry with exponential backoff for rate limits

Rate Limits (Telegram):
- 30 messages/second for private chats
- 1 message/second for groups (20 messages/minute)

Required: `TELEGRAM_BOT_TOKEN`

### Push (Mobile)

AWS SNS for iOS (APNs) and Android (FCM/GCM):

| Platform | Config |
|----------|--------|
| iOS Production | `SNS_APNS_PLATFORM_ARN` |
| iOS Sandbox | `SNS_APNS_SANDBOX_PLATFORM_ARN` |
| Android | `SNS_GCM_PLATFORM_ARN` |

Supports: badge, sound, TTL, custom data payload.

### Web Push (Browser)

Uses Web Push Protocol with VAPID authentication:

```bash
# Generate VAPID keys
npx web-push generate-vapid-keys
```

Required: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`

Supports: icon, badge, image, actions, vibrate, urgency, TTL.

## API Endpoints

### POST /v1/messages

Create and send a notification.

```json
{
  "idempotencyKey": "unique-key",
  "channels": ["email", "slack", "sms", "whatsapp", "telegram", "push", "web"],
  "sender": { 
    "name": "Acme",
    "email": "noreply@acme.com"
  },
  "recipient": { 
    "email": "user@example.com",
    "slack": { "userId": "U01ABC" },
    "sms": { "phoneNumber": "+5511999999999" },
    "whatsapp": { "phoneNumber": "+5511999999999" },
    "telegram": { "chatId": 123456789 },
    "push": { "deviceToken": "...", "platform": "APNS" },
    "web": { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } }
  },
  "payload": {
    "title": "Order Shipped",
    "text": "Your order is on the way!",
    "html": "<p>Your order is on the way!</p>"
  },
  "overrides": {
    "email": { "subject": "Custom Subject", "provider": "resend" },
    "slack": { "blocks": [] },
    "sms": { "provider": "twilio", "messageType": "Transactional" },
    "whatsapp": { "contentSid": "HX...", "mediaUrl": "https://..." },
    "telegram": { "parseMode": "HTML", "disableNotification": false },
    "push": { "badge": 1, "sound": "default", "ttl": 3600 },
    "web": { "icon": "/icon.png", "urgency": "high", "actions": [] }
  },
  "priority": "high",
  "scheduleAt": "2024-01-15T10:00:00Z"
}
```

### GET /v1/messages/:id

Get message status and delivery events.

### GET /health

Health check endpoint for load balancers.

## Compliance (GDPR/LGPD)

Maritaca includes built-in compliance features:

### Audit Logs

- **Separate audit trail**: All notifications logged with full context
- **Encrypted PII**: Recipient data encrypted at rest (AES-256-GCM)
- **Partitioned storage**: Monthly partitions for efficient data management
- **DSAR support**: Query logs by subject ID for data access requests

### PII Handling

| Log Type | PII Treatment | Destination |
|----------|---------------|-------------|
| System logs | Masked (`u***@example.com`) | stdout/OTLP |
| Audit logs | Encrypted | PostgreSQL |

### Data Retention

Automatic partition maintenance via BullMQ:
- Creates future partitions (default: 3 months ahead)
- Drops old partitions (default: after 12 months)
- Configurable via `AUDIT_RETENTION_MONTHS`

### Configuration

```bash
# Generate encryption key
openssl rand -base64 32

# Add to .env
AUDIT_ENCRYPTION_KEY=your-generated-key
AUDIT_RETENTION_MONTHS=12
```

## Observability

Built-in OpenTelemetry support for traces, metrics, and logs.

```bash
# Enable by setting OTLP endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Traces include:
- Message processing lifecycle
- Provider send operations
- Email lookups and cache hits
- Database operations

See [docs/observability.md](./docs/observability.md) for detailed setup.

## Environment Variables

All configuration is done via environment variables. See [.env.example](./.env.example) for the complete list with documentation.

### Core

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `AUDIT_ENCRYPTION_KEY` | Production | PII encryption key (AES-256) |

### Email

| Variable | Required | Description |
|----------|----------|-------------|
| `EMAIL_PROVIDER` | No | `mock`, `resend`, or `ses` (default: `mock`) |
| `RESEND_API_KEY` | For Resend | Resend API key |
| `AWS_REGION` | For SES/SNS | AWS region |

### Slack

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | For Slack | Bot token with `chat:write`, `users:read.email` |

### SMS

| Variable | Required | Description |
|----------|----------|-------------|
| `SMS_PROVIDER` | No | `sns` or `twilio` (default: `sns`) |
| `TWILIO_ACCOUNT_SID` | For Twilio | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | For Twilio | Twilio auth token |
| `TWILIO_SMS_FROM` | For Twilio | Sender phone number (E.164) |

### WhatsApp

| Variable | Required | Description |
|----------|----------|-------------|
| `TWILIO_WHATSAPP_FROM` | For WhatsApp | WhatsApp-enabled number (E.164) |

### Telegram

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | For Telegram | Bot token from [@BotFather](https://t.me/botfather) |

### Push (Mobile)

| Variable | Required | Description |
|----------|----------|-------------|
| `SNS_APNS_PLATFORM_ARN` | For iOS | APNs platform application ARN |
| `SNS_GCM_PLATFORM_ARN` | For Android | FCM platform application ARN |

### Web Push

| Variable | Required | Description |
|----------|----------|-------------|
| `VAPID_PUBLIC_KEY` | For Web Push | VAPID public key |
| `VAPID_PRIVATE_KEY` | For Web Push | VAPID private key |
| `VAPID_SUBJECT` | For Web Push | `mailto:` or `https:` URL |

## Development

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Run with coverage (80% threshold)
pnpm test:coverage

# Start API in dev mode
cd packages/api && pnpm dev

# Start worker in dev mode
cd packages/worker && pnpm dev
```

## Project Structure

```
maritaca/
├── packages/
│   ├── core/           # Shared types, validation, database
│   │   ├── src/
│   │   │   ├── audit/      # Audit service, encryption, partitions
│   │   │   ├── db/         # Schema, migrations, client
│   │   │   ├── logger/     # Pino logger, PII masking
│   │   │   ├── types/      # TypeScript types
│   │   │   └── validation/ # Zod schemas
│   │   └── ...
│   ├── api/            # Fastify HTTP server
│   ├── worker/         # BullMQ notification workers
│   │   ├── src/
│   │   │   ├── processors/ # Message, maintenance processors
│   │   │   ├── providers/
│   │   │   │   ├── email/    # Resend, SES, Mock
│   │   │   │   ├── slack/    # Slack API
│   │   │   │   ├── sms/      # AWS SNS
│   │   │   │   ├── push/     # AWS SNS (mobile)
│   │   │   │   ├── web/      # Web Push
│   │   │   │   ├── telegram/ # Telegram Bot API
│   │   │   │   └── twilio/   # SMS, WhatsApp
│   │   │   └── queues/     # Queue definitions
│   │   └── ...
│   └── sdk/            # TypeScript client
├── docs/               # Documentation
├── scripts/            # Utility scripts
└── docker-compose.yml  # Local development setup
```

## License

MIT

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

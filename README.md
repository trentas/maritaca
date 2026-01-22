<p align="center">
  <img src="assets/favicon.svg" alt="Maritaca" width="200">
</p>

# Maritaca

A self-hosted, event-oriented notification API for multi-channel notifications with a focus on developer experience.

Maritaca is to notifications what Resend is to email: simple, predictable, well-typed, easy to debug, and extensible through providers.

## Features

- **Event-first architecture**: Every notification generates explicit, queryable events
- **Multi-channel**: Email (Resend, AWS SES), Slack (users, channels), with more coming
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

# Run migrations
cd packages/core && pnpm db:push && cd ../..

# Create API key
pnpm create-api-key
```

### Send your first notification

```typescript
import { Maritaca } from '@maritaca/sdk'

const maritaca = new Maritaca({
  apiKey: process.env.MARITACA_API_KEY,
  baseUrl: 'http://localhost:7377'
})

// Send via Slack
await maritaca.messages.send({
  idempotencyKey: 'order-123-confirmed',
  channels: ['slack'],
  sender: { name: 'Acme Store' },
  recipient: { 
    slack: { userId: 'U01ABC123' }  // or channelName: 'orders'
  },
  payload: {
    title: 'Order Confirmed',
    text: 'Your order #123 has been confirmed!'
  }
})

// Send via Email
await maritaca.messages.send({
  idempotencyKey: 'welcome-user-456',
  channels: ['email'],
  sender: { 
    name: 'Acme Store',
    email: 'hello@acme.com'
  },
  recipient: { 
    email: 'customer@example.com'
  },
  payload: {
    title: 'Welcome to Acme!',
    text: 'Thanks for signing up.',
    html: '<h1>Welcome!</h1><p>Thanks for signing up.</p>'
  }
})
```

### Using cURL

```bash
# Send Slack message
curl -X POST http://localhost:7377/v1/messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "test-123",
    "channels": ["slack"],
    "sender": { "name": "Test" },
    "recipient": { "slack": { "channelName": "general" } },
    "payload": { "text": "Hello from Maritaca!" }
  }'

# Send email via Resend
curl -X POST http://localhost:7377/v1/messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "email-456",
    "channels": ["email"],
    "sender": { "name": "Acme", "email": "noreply@acme.com" },
    "recipient": { "email": "user@example.com" },
    "payload": { 
      "title": "Welcome!", 
      "text": "Thanks for joining." 
    }
  }'
```

## Providers

### Email Providers

| Provider | Description | Required Config |
|----------|-------------|-----------------|
| **mock** | Logs emails (development) | None |
| **resend** | [Resend](https://resend.com) API | `RESEND_API_KEY` |
| **ses** | AWS Simple Email Service | `AWS_REGION`, credentials |

Set `EMAIL_PROVIDER` environment variable to choose (default: `mock`).

### Slack Provider

Send messages to users or channels with multiple recipient options:

| Recipient Type | Example | Description |
|----------------|---------|-------------|
| `userId` | `U01ABC123` | Direct message to user |
| `channelId` | `C01XYZ789` | Post to channel by ID |
| `channelName` | `general` | Post to channel by name |
| `email` | `user@company.com` | Lookup user by email, send DM |

Features:
- LRU cache for email→userId lookups (configurable size/TTL)
- Automatic retry with exponential backoff for rate limits
- Custom Slack blocks support via `overrides.slack.blocks`

Required: `SLACK_BOT_TOKEN` with scopes `chat:write`, `users:read.email`

## API Endpoints

### POST /v1/messages

Create and send a notification.

```json
{
  "idempotencyKey": "unique-key",
  "channels": ["email", "slack"],
  "sender": { 
    "name": "Acme",
    "email": "noreply@acme.com"
  },
  "recipient": { 
    "email": "user@example.com",
    "slack": { "userId": "U01ABC" }
  },
  "payload": {
    "title": "Order Shipped",
    "text": "Your order is on the way!",
    "html": "<p>Your order is on the way!</p>"
  },
  "overrides": {
    "email": { "subject": "Custom Subject" },
    "slack": { "blocks": [...] }
  }
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

Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `SLACK_BOT_TOKEN` | For Slack | Slack bot token |
| `EMAIL_PROVIDER` | No | `mock`, `resend`, or `ses` |
| `RESEND_API_KEY` | For Resend | Resend API key |
| `AWS_REGION` | For SES | AWS region |
| `AUDIT_ENCRYPTION_KEY` | Production | PII encryption key |

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
│   │   │   ├── providers/  # Email, Slack providers
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

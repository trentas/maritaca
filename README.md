```
  ,_,
 (o,o)
 {`"`}
 -"-"-
```

# Maritaca

A self-hosted, event-oriented notification API for multi-channel notifications with a focus on developer experience.

Maritaca is to notifications what Resend is to email: simple, predictable, well-typed, easy to debug, and extensible through providers.

## Features

- 🚀 **Event-first architecture**: Everything generates explicit events
- 🔌 **Provider-agnostic**: Core never depends on external APIs directly
- 👨‍💻 **Developer-first**: Easy to understand without extensive documentation
- 🏠 **Self-hosted by default**: No mandatory external SaaS dependencies
- 🔄 **Idempotent by design**: Retries never create duplicates
- 📊 **Multi-channel**: Send notifications via email, Slack, push, web, and more
- 🎯 **Type-safe**: Full TypeScript support with strong typing

## Architecture

Maritaca is built as a monorepo with 4 packages:

- **@maritaca/core**: Shared types, validation, event model, provider interfaces
- **@maritaca/api**: Fastify HTTP API server
- **@maritaca/worker**: BullMQ worker for processing notifications
- **@maritaca/sdk**: TypeScript client library

## Quick Start

### Prerequisites

- Node.js 22 LTS
- pnpm 8+
- Docker and Docker Compose
- PostgreSQL 15
- Redis 7

### Installation

1. Clone the repository:

```bash
git clone https://github.com/trentas/maritaca.git
cd maritaca
```

2. Install dependencies:

```bash
pnpm install
```

3. Set up environment variables:

Copy the example environment file and update with your values:

```bash
cp .env.example .env
```

Or create a `.env` file manually with the following variables:

```bash
# Database Configuration
DATABASE_URL=postgresql://maritaca:maritaca@localhost:5432/maritaca

# Redis Configuration
REDIS_URL=redis://localhost:6379

# API Configuration
PORT=7377
HOST=0.0.0.0
LOG_LEVEL=info

# Slack Provider (optional)
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token-here
```

4. Start services with Docker Compose:

```bash
docker-compose up -d
```

This will start:
- PostgreSQL database
- Redis queue
- API server (port 7377)
- Worker service

5. Run database migrations:

```bash
cd packages/core && pnpm db:push && cd ../..
```

6. Create an API key (from the project root):

```bash
pnpm create-api-key
```

This will generate an API key that you'll need to authenticate requests. Save the key as it won't be shown again.

### Using the SDK

```typescript
import { Maritaca } from '@maritaca/sdk'

const maritaca = new Maritaca({
  apiKey: process.env.MARITACA_API_KEY,
  baseUrl: 'http://localhost:7377'
})

await maritaca.messages.send({
  idempotencyKey: 'order-123-paid',
  channels: ['slack'],
  sender: { name: 'Acme' },
  recipient: { slack: { userId: 'U01ABC' } },
  payload: {
    text: 'Order paid successfully'
  }
})
```

## Development

### Building

```bash
pnpm build
```

### Testing

Run all tests:

```bash
pnpm test
```

Run tests with coverage:

```bash
pnpm test:coverage
```

Coverage threshold is set to 80% minimum.

### Running Locally

Start the API server:

```bash
cd packages/api
pnpm dev
```

Start the worker:

```bash
cd packages/worker
pnpm dev
```

## API Endpoints

### POST /v1/messages

Create a new message.

**Request:**
```json
{
  "idempotencyKey": "unique-key",
  "channels": ["slack"],
  "sender": { "name": "Acme" },
  "recipient": { "slack": { "userId": "U01ABC" } },
  "payload": {
    "text": "Hello, world!"
  }
}
```

**Response:**
```json
{
  "messageId": "msg_123",
  "status": "pending",
  "channels": ["slack"]
}
```

### GET /v1/messages/:id

Get message status and events.

**Response:**
```json
{
  "id": "msg_123",
  "status": "delivered",
  "envelope": { ... },
  "events": [ ... ]
}
```

## Providers

### Slack Provider

Real Slack API integration. Requires a Slack bot token.

**Configuration:**
- Set `SLACK_BOT_TOKEN` environment variable, or
- Provide `botToken` in the sender's `slack` field

### Email Provider (Mock)

Currently a mock provider that logs messages. Real email providers (Resend, SMTP) coming soon.

## Environment Variables

Required:

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `PORT`: API server port (default: 7377)
- `HOST`: API server host (default: 0.0.0.0)
- `LOG_LEVEL`: Logging level (default: info)
- `SLACK_BOT_TOKEN`: Slack bot token (optional, can be provided per message)

Optional (OpenTelemetry / observability): `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, `OTEL_EXPORTER_OTLP_INSECURE`. See [docs/signoz-howto.md](./docs/signoz-howto.md) for SigNoz integration.

## Observability

Traces, metrics and logs are exported via OpenTelemetry (OTLP) when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. [docs/signoz-howto.md](./docs/signoz-howto.md) explains how to configure SigNoz and Maritaca.

## License

MIT

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

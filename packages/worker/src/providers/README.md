# Maritaca Notification Providers

This directory contains the notification provider implementations for Maritaca. Each provider handles sending messages through a specific channel.

## Available Providers

### Email Providers

#### MockEmailProvider
A mock implementation for testing. Logs messages instead of sending them.

```typescript
import { MockEmailProvider } from './email/mock.js'

const provider = new MockEmailProvider({
  simulation: {
    delayMs: 100,           // Simulate 100ms network delay
    failureRate: 0.1,       // 10% chance of random failure
    recipientErrors: {
      'bad@example.com': 'Mailbox not found',
    },
  },
})
```

#### ResendProvider
Send emails via [Resend](https://resend.com) API.

```typescript
import { ResendProvider } from './email/resend.js'

// Using environment variable RESEND_API_KEY
const provider = new ResendProvider()

// Or with explicit API key
const provider = new ResendProvider({
  apiKey: 're_xxxxx',
})

// Health check
const health = await provider.healthCheck()
if (!health.ok) {
  console.error('Provider unhealthy:', health.error)
}
```

**Environment Variables:**
- `RESEND_API_KEY` - Your Resend API key

#### SESProvider
Send emails via AWS Simple Email Service.

```typescript
import { SESProvider } from './email/ses.js'

// Using environment variables
const provider = new SESProvider()

// Or with explicit credentials
const provider = new SESProvider({
  region: 'us-east-1',
  accessKeyId: 'AKIA...',
  secretAccessKey: '...',
})
```

**Environment Variables:**
- `AWS_REGION` or `AWS_DEFAULT_REGION` - AWS region
- `AWS_ACCESS_KEY_ID` - AWS access key (optional if using IAM role)
- `AWS_SECRET_ACCESS_KEY` - AWS secret key (optional if using IAM role)

### Slack Provider

Send messages to Slack users or channels.

```typescript
import { SlackProvider } from './slack.js'

const provider = new SlackProvider({
  retryConfig: {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  },
  cacheMaxSize: 1000,     // Max email->userId cache entries
  cacheTtlMs: 5 * 60 * 1000, // 5 minute cache TTL
})

// Health check
const health = await provider.healthCheck()
console.log('Bot info:', health.details)
```

**Environment Variables:**
- `SLACK_BOT_TOKEN` - Slack bot token (xoxb-...)

**Recipient Types:**
- `userId` - Send DM to user (e.g., `U0123456789`)
- `channelId` - Post to channel by ID (e.g., `C0123456789`)
- `channelName` - Post to channel by name (e.g., `general` or `#general`)
- `email` - Lookup user by email and send DM

## Factory Function

Use the factory function to create email providers based on configuration:

```typescript
import { createEmailProvider } from './email/index.js'

// Use EMAIL_PROVIDER env var (defaults to 'mock')
const provider = createEmailProvider()

// Or specify explicitly
const resendProvider = createEmailProvider('resend')
const sesProvider = createEmailProvider('ses')
const mockProvider = createEmailProvider('mock')
```

## Health Checks

All providers implement a `healthCheck()` method:

```typescript
interface HealthCheckResult {
  ok: boolean
  error?: string
  details?: Record<string, any>
}

const result = await provider.healthCheck()
if (!result.ok) {
  console.error('Provider unhealthy:', result.error)
}
```

## OpenTelemetry Integration

All providers include OpenTelemetry tracing:

- Spans are created for `send()` operations
- Attributes include recipient count, provider name, external IDs
- Errors are recorded as span events

Configure OpenTelemetry in your application to collect traces:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'

const sdk = new NodeSDK({
  // ... your configuration
})
sdk.start()
```

## Provider Interface

All providers implement the `Provider` interface from `@maritaca/core`:

```typescript
interface Provider {
  channel: Channel
  validate(envelope: Envelope): void
  prepare(envelope: Envelope): PreparedMessage
  send(prepared: PreparedMessage): Promise<ProviderResponse>
  mapEvents(response: ProviderResponse, messageId: string): MaritacaEvent[]
}
```

## Retry Logic

The Slack provider includes automatic retry with exponential backoff for rate limit (429) errors:

- Default: 3 retries with 1-30 second delays
- Respects Slack's `Retry-After` header when available
- Adds jitter to prevent thundering herd

## Email Lookup Caching

The Slack provider caches email → userId lookups using an LRU cache:

- Default: 1000 entries, 5 minute TTL
- Prevents repeated API calls for the same email
- Can be cleared with `provider.clearEmailCache()`
- Stats available via `provider.getEmailCacheStats()`
